import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { databaseErrorMessage, getConnection } from '@/lib/db';
import {
  assertAttachmentOwnerType,
  assertAttachmentUsageType,
  ATTACHMENT_OWNER_TYPES,
  ATTACHMENT_USAGE_TYPES,
} from '@/server/attachments/attachmentConstants';

export const runtime = 'nodejs';

const MAX_IMAGE_SIZE = 1024 * 1024;
const DB_OPERATION_TIMEOUT_MS = 115000;
const ALLOWED_IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const CHOICE_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function numberOrNull(value) {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function usesChoices(type) {
  return type === 'single_choice' || type === 'multiple_choice';
}

function countChoiceValues(record) {
  return CHOICE_KEYS.filter((key) => emptyToNull(record?.[key]) !== null).length;
}

function nodeNumber(record) {
  return emptyToNull(record?.question_number ?? record?.subquestion_number);
}

function nodeText(record) {
  return emptyToNull(record?.question_text ?? record?.subquestion_text);
}

function normalizeQuestionNodes(payload) {
  if (Array.isArray(payload.question_nodes)) {
    return payload.question_nodes.map((node) => ({
      ...node,
      q_level: normalizeNodeLevel(node),
      question_number: node.question_number ?? node.subquestion_number,
      question_text: node.question_text ?? node.subquestion_text,
      choices: node.choices || null,
    }));
  }

  return (payload.subquestions || []).map((subquestion) => {
    const subchoice = (payload.subchoices || []).find(
      (item) => item._parent_subquestion_client_key === subquestion._client_key,
    );
    return {
      ...subquestion,
      q_level: 2,
      _parent_client_key: null,
      question_number: subquestion.subquestion_number,
      question_text: subquestion.subquestion_text,
      choices: subchoice || null,
    };
  });
}

function normalizeNodeLevel(node) {
  const explicitLevel = Number(node?.q_level);
  if ([2, 3].includes(explicitLevel)) return explicitLevel;
  return emptyToNull(node?._parent_client_key) === null ? 2 : 3;
}

function validateImage(file, label) {
  if (!file) return null;
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return `${label} 僅允許 jpg、png、webp`;
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return `${label} 不可超過 1MB`;
  }
  return null;
}

function validatePayload(payload, files) {
  const errors = [];
  const question = payload.questions || {};
  const questionNodes = normalizeQuestionNodes(payload);
  const questionType = emptyToNull(question.question_type);
  const examId = numberOrNull(question.exam_id);
  const nodeByClientKey = new Map();

  if (examId && !emptyToNull(question.question_number)) errors.push('題號必填');
  if (!questionType) errors.push('問題類型必填');
  if (!emptyToNull(question.question_text) && !files.questionImage && questionNodes.length === 0) {
    errors.push('沒有下層題目時，題目主文或主題目圖片至少需要一項');
  }
  if (usesChoices(questionType) && countChoiceValues(payload.choices) < 2) {
    errors.push('選擇題至少需填寫 A、B 兩個選項');
  }

  questionNodes.forEach((node, index) => {
    const label = `第 ${index + 1} 個下層題目`;
    const nodeType = emptyToNull(node.question_type);
    const nodeLevel = Number(node.q_level);
    const nodeImage = files.questionImages.get(node._client_key);
    if (!node._client_key) errors.push(`${label} 缺少 client key`);
    if (node._client_key && nodeByClientKey.has(node._client_key)) errors.push(`${label} client key 重複`);
    if (node._client_key) nodeByClientKey.set(node._client_key, node);
    if (![2, 3].includes(nodeLevel)) errors.push(`${label} 層級必須為 2 或 3`);
    if (nodeLevel === 2 && emptyToNull(node._parent_client_key) !== null) errors.push(`${label} 第二層題目的 parent 必須是主題目`);
    if (nodeLevel === 3 && !emptyToNull(node._parent_client_key)) errors.push(`${label} 第三層題目必須指定第二層 parent`);
    if (!nodeNumber(node)) errors.push(`${label} 題號必填`);
    if (!nodeType) errors.push(`${label} 問題類型必填`);
    if (!nodeText(node) && !nodeImage) {
      errors.push(`${label} 題目主文或圖片至少需要一項`);
    }
    if (usesChoices(nodeType) && countChoiceValues(node.choices) < 2) {
      errors.push(`${label} 選擇題至少需填寫 A、B 兩個選項`);
    }
  });

  questionNodes
    .filter((node) => Number(node.q_level) === 3)
    .forEach((node) => {
      const parent = nodeByClientKey.get(node._parent_client_key);
      if (!parent || Number(parent.q_level) !== 2) {
        errors.push(`第三層題目 ${node._client_key} 的 parent 必須是第二層題目`);
      }
    });

  const questionImageError = validateImage(files.questionImage, '主題目圖片');
  if (questionImageError) errors.push(questionImageError);
  for (const [clientKey, file] of files.questionImages.entries()) {
    const imageError = validateImage(file, `下層題目圖片 ${clientKey}`);
    if (imageError) errors.push(imageError);
  }

  return errors;
}

async function storeImage(file, ownerType, ownerId) {
  const extension = ALLOWED_IMAGE_TYPES.get(file.type);
  const storedFilename = `${randomUUID()}.${extension}`;
  const year = new Date().getUTCFullYear();
  const month = String(new Date().getUTCMonth() + 1).padStart(2, '0');
  const relativeDir = `uploads/${ownerType}s/${year}/${month}/${ownerId}`;
  const absoluteDir = path.join(process.cwd(), 'public', relativeDir);
  await mkdir(absoluteDir, { recursive: true });
  const absolutePath = path.join(absoluteDir, storedFilename);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(absolutePath, bytes);
  return {
    absolutePath,
    record: {
      disk: 'local',
      path: `${relativeDir}/${storedFilename}`.replaceAll('\\', '/'),
      url: null,
      original_filename: file.name || storedFilename,
      stored_filename: storedFilename,
      mime_type: file.type,
      file_size: file.size,
      extension,
      width: null,
      height: null,
      checksum: null,
    },
  };
}

async function insertAttachment(connection, ownerType, ownerId, usageType, stored) {
  assertAttachmentOwnerType(ownerType);
  assertAttachmentUsageType(usageType);

  await connection.execute(
    `INSERT INTO attachments (
      owner_type, owner_id, usage_type, disk, path, url, original_filename, stored_filename,
      mime_type, file_size, extension, width, height, checksum, display_order, alt_text, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL)`,
    [
      ownerType,
      ownerId,
      usageType,
      stored.disk,
      stored.path,
      stored.url,
      stored.original_filename,
      stored.stored_filename,
      stored.mime_type,
      stored.file_size,
      stored.extension,
      stored.width,
      stored.height,
      stored.checksum,
    ],
  );
}

function parseFiles(formData) {
  const questionImage = formData.get('question_image');
  const questionImages = new Map();
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('subquestion_image__') && value instanceof File && value.size > 0) {
      questionImages.set(key.replace('subquestion_image__', ''), value);
    }
    if (key.startsWith('question_image__') && value instanceof File && value.size > 0) {
      questionImages.set(key.replace('question_image__', ''), value);
    }
  }
  return {
    questionImage: questionImage instanceof File && questionImage.size > 0 ? questionImage : null,
    questionImages,
  };
}

async function insertChoiceRecord(connection, questionId, choices) {
  await connection.execute(
    `INSERT INTO choices (question_id, A, B, C, D, E, F, G, H)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [questionId, ...CHOICE_KEYS.map((key) => emptyToNull(choices?.[key]))],
  );
}

async function insertQuestionNode(connection, node, { examId, parentId, qLevel, rootId }) {
  const [result] = await connection.execute(
    `INSERT INTO questions (
      question_number, question_text, exam_id, parent_id, q_level, root_id, score, question_type, difficulty, source, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nodeNumber(node),
      nodeText(node),
      examId,
      parentId,
      qLevel,
      rootId,
      numberOrNull(node.score),
      emptyToNull(node.question_type),
      emptyToNull(node.difficulty),
      emptyToNull(node.source),
      emptyToNull(node.note),
    ],
  );
  return result.insertId;
}

export async function POST(request) {
  const uploadedPaths = [];
  let connection;
  let timedOut = false;
  let timeoutId;

  try {
    connection = await getConnection();
    timeoutId = setTimeout(() => {
    timedOut = true;
    connection.destroy();
  }, DB_OPERATION_TIMEOUT_MS);
    const formData = await request.formData();
    const payload = JSON.parse(String(formData.get('payload') || '{}'));
    const files = parseFiles(formData);
    const validationErrors = validatePayload(payload, files);

    if (validationErrors.length > 0) {
      return Response.json({ success: false, message: 'Validation failed', errors: validationErrors }, { status: 422 });
    }

    await connection.beginTransaction();

    const question = payload.questions;
    const examId = numberOrNull(question.exam_id);
    const questionId = await insertQuestionNode(connection, question, {
      examId,
      parentId: null,
      qLevel: 1,
      rootId: null,
    });

    await connection.execute(
      `UPDATE questions
       SET root_id = ?
       WHERE id = ?`,
      [questionId, questionId],
    );

    if (usesChoices(emptyToNull(question.question_type))) {
      await insertChoiceRecord(connection, questionId, payload.choices || {});
    }

    if (files.questionImage) {
      const stored = await storeImage(files.questionImage, ATTACHMENT_OWNER_TYPES.QUESTION, questionId);
      uploadedPaths.push(stored.absolutePath);
      await insertAttachment(connection, ATTACHMENT_OWNER_TYPES.QUESTION, questionId, ATTACHMENT_USAGE_TYPES.QUESTION_PROMPT, stored.record);
    }

    const nodeIdByClientKey = new Map();
    const nodes = normalizeQuestionNodes(payload).sort((a, b) => Number(a.q_level) - Number(b.q_level));
    for (const node of nodes) {
      const qLevel = Number(node.q_level);
      const parentId = qLevel === 2 ? questionId : nodeIdByClientKey.get(node._parent_client_key);
      if (!parentId) throw new Error('Missing parent question id');

      const nodeId = await insertQuestionNode(connection, node, {
        examId,
        parentId,
        qLevel,
        rootId: questionId,
      });
      nodeIdByClientKey.set(node._client_key, nodeId);

      if (usesChoices(emptyToNull(node.question_type))) {
        await insertChoiceRecord(connection, nodeId, node.choices || {});
      }

      const nodeImage = files.questionImages.get(node._client_key);
      if (nodeImage) {
        const stored = await storeImage(nodeImage, ATTACHMENT_OWNER_TYPES.QUESTION, nodeId);
        uploadedPaths.push(stored.absolutePath);
        await insertAttachment(connection, ATTACHMENT_OWNER_TYPES.QUESTION, nodeId, ATTACHMENT_USAGE_TYPES.QUESTION_PROMPT, stored.record);
      }
    }

    await connection.commit();

    return Response.json(
      {
        success: true,
        message: 'Question created',
        data: {
          id: questionId,
          redirect_to: examId
            ? `/prototype/exam-questions.html?exam_id=${examId}`
            : '/prototype/independent-questions.html',
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (connection && !timedOut) {
      await connection.rollback().catch(() => {});
    }
    for (const uploadedPath of uploadedPaths) {
      await unlink(uploadedPath).catch(() => {});
    }

    if (timedOut) {
      return Response.json({ success: false, message: 'Request timeout. Please try again later.' }, { status: 504 });
    }

    console.error('Failed to create question:', error);
    const message = databaseErrorMessage(error) || 'Failed to create question';
    return Response.json({ success: false, message }, { status: 500 });
  } finally {
    clearTimeout(timeoutId);
    if (connection && !timedOut) {
      connection.release();
    }
  }
}
