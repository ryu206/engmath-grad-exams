import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { databaseErrorMessage, getConnection } from '@/lib/db';
import { buildQuestionTree } from '@/lib/questionTree';
import {
  assertAttachmentOwnerType,
  assertAttachmentUsageType,
  ATTACHMENT_OWNER_TYPES,
  ATTACHMENT_USAGE_TYPES,
} from '@/server/attachments/attachmentConstants';

export const runtime = 'nodejs';

const MAX_IMAGE_SIZE = 1024 * 1024;
const DB_OPERATION_TIMEOUT_MS = 115000;
const CHOICE_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const ALLOWED_IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

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

function idFromParams(params) {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function usesChoices(type) {
  return type === 'single_choice' || type === 'multiple_choice';
}

function countChoices(record) {
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
      id: positiveInteger(node.id),
      q_level: normalizeNodeLevel(node),
      question_number: node.question_number ?? node.subquestion_number,
      question_text: node.question_text ?? node.subquestion_text,
      choices: node.choices || node.subchoices || null,
    }));
  }

  return (payload.subquestions || []).map((subquestion) => {
    const subchoice = (payload.subchoices || []).find(
      (item) => item._parent_subquestion_client_key === subquestion._client_key,
    );
    return {
      ...subquestion,
      id: positiveInteger(subquestion.id),
      q_level: 2,
      _parent_client_key: null,
      question_number: subquestion.subquestion_number,
      question_text: subquestion.subquestion_text,
      choices: subchoice || subquestion.subchoices || null,
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
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return `${label} 僅允許 jpg、png、webp`;
  if (file.size > MAX_IMAGE_SIZE) return `${label} 不可超過 1MB`;
  return null;
}

function validatePayload(payload, files, currentQuestion = null) {
  const errors = [];
  const question = payload.questions || {};
  const questionNodes = normalizeQuestionNodes(payload);
  const questionType = emptyToNull(question.question_type);
  const isExamQuestion = currentQuestion?.exam_id !== null && currentQuestion?.exam_id !== undefined;
  const nodeByClientKey = new Map();

  if (isExamQuestion && !emptyToNull(question.question_number)) errors.push('題號必填');
  if (!questionType) errors.push('問題類型必填');
  if (!emptyToNull(question.question_text) && !files.questionImage && questionNodes.length === 0 && !question.keep_question_image) {
    errors.push('沒有下層題目時，題目主文或主題目圖片至少需要一項');
  }
  if (usesChoices(questionType) && countChoices(payload.choices) < 2) errors.push('選擇題至少需填寫 A、B 兩個選項');

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
    if (!nodeText(node) && !nodeImage && !node.keep_image) errors.push(`${label} 題目主文或圖片至少需要一項`);
    if (usesChoices(nodeType) && countChoices(node.choices) < 2) errors.push(`${label} 選擇題至少需填寫 A、B 兩個選項`);
  });

  questionNodes
    .filter((node) => Number(node.q_level) === 3)
    .forEach((node) => {
      const parent = nodeByClientKey.get(node._parent_client_key);
      if (!parent || Number(parent.q_level) !== 2) errors.push(`第三層題目 ${node._client_key} 的 parent 必須是第二層題目`);
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
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const relativeDir = `uploads/${ownerType}s/${year}/${month}/${ownerId}`;
  const absoluteDir = path.join(process.cwd(), 'public', relativeDir);
  await mkdir(absoluteDir, { recursive: true });
  const absolutePath = path.join(absoluteDir, storedFilename);
  await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));
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

async function softDeleteAttachments(connection, ownerType, ownerId) {
  await connection.execute(
    `UPDATE attachments
     SET deleted_at = CURRENT_TIMESTAMP
     WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL`,
    [ownerType, ownerId],
  );
}

function parseFiles(formData) {
  const questionImage = formData.get('question_image');
  const questionImages = new Map();
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('question_image__') && value instanceof File && value.size > 0) {
      questionImages.set(key.replace('question_image__', ''), value);
    }
    if (key.startsWith('subquestion_image__') && value instanceof File && value.size > 0) {
      questionImages.set(key.replace('subquestion_image__', ''), value);
    }
  }
  return {
    questionImage: questionImage instanceof File && questionImage.size > 0 ? questionImage : null,
    questionImages,
  };
}

async function withTimedConnection(callback) {
  const connection = await getConnection();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    connection.destroy();
  }, DB_OPERATION_TIMEOUT_MS);

  try {
    return await callback(connection);
  } catch (error) {
    if (timedOut) throw new Error('REQUEST_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (!timedOut) connection.release();
  }
}

async function fetchRelatedRows(connection, questionIds) {
  if (questionIds.length === 0) return { choices: [], attachments: [], answers: [] };
  const placeholders = questionIds.map(() => '?').join(',');
  const [choices] = await connection.query(
    `SELECT * FROM choices WHERE question_id IN (${placeholders}) AND deleted_at IS NULL`,
    questionIds,
  );
  const [attachments] = await connection.query(
    `SELECT id, owner_type, owner_id, usage_type, path, url, original_filename, mime_type, width, height
     FROM attachments
     WHERE owner_type = ? AND owner_id IN (${placeholders}) AND deleted_at IS NULL
     ORDER BY display_order, id`,
    [ATTACHMENT_OWNER_TYPES.QUESTION, ...questionIds],
  );
  return { choices, attachments };
}

async function upsertChoices(connection, questionId, questionType, choices) {
  await connection.execute(
    `UPDATE choices SET deleted_at = CURRENT_TIMESTAMP WHERE question_id = ? AND deleted_at IS NULL`,
    [questionId],
  );
  if (!usesChoices(emptyToNull(questionType))) return;
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

async function updateQuestionNode(connection, id, node) {
  await connection.execute(
    `UPDATE questions
     SET question_number = ?, question_text = ?, score = ?, question_type = ?, difficulty = ?, source = ?, note = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [
      nodeNumber(node),
      nodeText(node),
      numberOrNull(node.score),
      emptyToNull(node.question_type),
      emptyToNull(node.difficulty),
      emptyToNull(node.source),
      emptyToNull(node.note),
      id,
    ],
  );
}

export async function GET(_request, { params }) {
  const questionId = idFromParams(await params);
  if (!questionId) return Response.json({ success: false, message: 'Invalid question id' }, { status: 400 });

  try {
    return await withTimedConnection(async (connection) => {
      const [rows] = await connection.execute(
        `SELECT q.*, e.source_kind, e.title, e.source AS exam_source, e.roc_year, e.university, e.department, e.division, e.subject, e.paper
         FROM questions q
         LEFT JOIN exams e ON e.id = q.exam_id
         WHERE q.id = ? AND q.deleted_at IS NULL
         LIMIT 1`,
        [questionId],
      );
      if (rows.length === 0) return Response.json({ success: false, message: 'Question not found' }, { status: 404 });

      const row = rows[0];
      const rootId = row.root_id || row.id;
      const [treeRows] = await connection.execute(
          `SELECT id, question_number, question_text, exam_id, parent_id, q_level, root_id,
                score, question_type, difficulty, source, note
         FROM questions
         WHERE (id = ? OR root_id = ?) AND deleted_at IS NULL`,
        [rootId, rootId],
      );
      const related = await fetchRelatedRows(connection, treeRows.map((item) => item.id));
      const question = buildQuestionTree(treeRows, related)[0] || null;

      const exam = row.exam_id
        ? {
            id: row.exam_id,
            source_kind: row.source_kind,
            title: row.title,
            source: row.exam_source,
            roc_year: row.roc_year,
            university: row.university,
            department: row.department,
            division: row.division,
            subject: row.subject,
            paper: row.paper,
          }
        : null;

      return Response.json(
        {
          success: true,
          data: {
            exam: exam ? { ...exam, display_name: exam.title || '' } : null,
            question,
          },
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    });
  } catch (error) {
    if (error.message === 'REQUEST_TIMEOUT') return Response.json({ success: false, message: 'Request timeout' }, { status: 504 });
    console.error('Failed to fetch question:', error);
    return Response.json({ success: false, message: 'Failed to fetch question' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  const questionId = idFromParams(await params);
  if (!questionId) return Response.json({ success: false, message: 'Invalid question id' }, { status: 400 });
  const uploadedPaths = [];

  try {
    const formData = await request.formData();
    const payload = JSON.parse(String(formData.get('payload') || '{}'));
    const files = parseFiles(formData);

    return await withTimedConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [currentRows] = await connection.execute(
          `SELECT id, exam_id, root_id
           FROM questions
           WHERE id = ? AND parent_id IS NULL AND deleted_at IS NULL
           LIMIT 1`,
          [questionId],
        );

        if (currentRows.length === 0) {
          await connection.rollback();
          return Response.json({ success: false, message: 'Question not found' }, { status: 404 });
        }

        const current = currentRows[0];
        const validationErrors = validatePayload(payload, files, current);
        if (validationErrors.length > 0) {
          await connection.rollback();
          return Response.json({ success: false, message: 'Validation failed', errors: validationErrors }, { status: 422 });
        }

        const question = payload.questions || {};
        await updateQuestionNode(connection, questionId, question);
        await connection.execute(`UPDATE questions SET root_id = ? WHERE id = ?`, [questionId, questionId]);
        await upsertChoices(connection, questionId, question.question_type, payload.choices || {});

        if (question.delete_question_image || files.questionImage) await softDeleteAttachments(connection, ATTACHMENT_OWNER_TYPES.QUESTION, questionId);
        if (files.questionImage) {
          const stored = await storeImage(files.questionImage, ATTACHMENT_OWNER_TYPES.QUESTION, questionId);
          uploadedPaths.push(stored.absolutePath);
          await insertAttachment(connection, ATTACHMENT_OWNER_TYPES.QUESTION, questionId, ATTACHMENT_USAGE_TYPES.QUESTION_PROMPT, stored.record);
        }

        const [existingRows] = await connection.execute(
          `SELECT id, q_level, parent_id
           FROM questions
           WHERE root_id = ? AND id <> ? AND deleted_at IS NULL`,
          [questionId, questionId],
        );
        const existingIds = new Set(existingRows.map((row) => row.id));
        const keptIds = new Set();
        const clientKeyToId = new Map();
        const nodes = normalizeQuestionNodes(payload).sort((a, b) => Number(a.q_level) - Number(b.q_level));

        for (const node of nodes) {
          const qLevel = Number(node.q_level);
          const parentId = qLevel === 2 ? questionId : clientKeyToId.get(node._parent_client_key);
          if (!parentId) throw new Error('Missing parent question id');

          let nodeId = node.id && existingIds.has(node.id) ? node.id : null;
          if (nodeId) {
            await updateQuestionNode(connection, nodeId, node);
          } else {
            nodeId = await insertQuestionNode(connection, node, {
              examId: current.exam_id,
              parentId,
              qLevel,
              rootId: questionId,
            });
          }

          keptIds.add(nodeId);
          clientKeyToId.set(node._client_key, nodeId);
          await upsertChoices(connection, nodeId, node.question_type, node.choices || {});

          if (node.delete_image || files.questionImages.has(node._client_key)) {
            await softDeleteAttachments(connection, ATTACHMENT_OWNER_TYPES.QUESTION, nodeId);
          }
          const nodeImage = files.questionImages.get(node._client_key);
          if (nodeImage) {
            const stored = await storeImage(nodeImage, ATTACHMENT_OWNER_TYPES.QUESTION, nodeId);
            uploadedPaths.push(stored.absolutePath);
            await insertAttachment(connection, ATTACHMENT_OWNER_TYPES.QUESTION, nodeId, ATTACHMENT_USAGE_TYPES.QUESTION_PROMPT, stored.record);
          }
        }

        let removedIds;
        if (Array.isArray(payload.question_nodes)) {
          removedIds = [...existingIds].filter((id) => !keptIds.has(id));
        } else {
          const removedLevel2Ids = existingRows
            .filter((row) => Number(row.q_level) === 2 && !keptIds.has(row.id))
            .map((row) => row.id);
          const removedLevel2Set = new Set(removedLevel2Ids);
          removedIds = existingRows
            .filter((row) => removedLevel2Set.has(row.id) || removedLevel2Set.has(row.parent_id))
            .map((row) => row.id);
        }
        if (removedIds.length > 0) {
          const placeholders = removedIds.map(() => '?').join(',');
          await connection.query(`UPDATE choices SET deleted_at = CURRENT_TIMESTAMP WHERE question_id IN (${placeholders}) AND deleted_at IS NULL`, removedIds);
          await connection.query(
            `UPDATE attachments SET deleted_at = CURRENT_TIMESTAMP WHERE owner_type = ? AND owner_id IN (${placeholders}) AND deleted_at IS NULL`,
            [ATTACHMENT_OWNER_TYPES.QUESTION, ...removedIds],
          );
          await connection.query(`UPDATE questions SET deleted_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND deleted_at IS NULL`, removedIds);
        }

        await connection.commit();
        return Response.json({
          success: true,
          message: 'Question updated',
          data: { id: questionId, redirect_to: `/prototype/edit-question.html?id=${questionId}` },
        });
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      }
    });
  } catch (error) {
    for (const uploadedPath of uploadedPaths) await unlink(uploadedPath).catch(() => {});
    if (error.message === 'REQUEST_TIMEOUT') return Response.json({ success: false, message: 'Request timeout' }, { status: 504 });
    if (error instanceof SyntaxError) return Response.json({ success: false, message: 'Invalid JSON payload' }, { status: 400 });
    console.error('Failed to update question:', error);
    const message = databaseErrorMessage(error) || 'Failed to update question';
    return Response.json({ success: false, message }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  const questionId = idFromParams(await params);
  if (!questionId) return Response.json({ success: false, message: 'Invalid question id' }, { status: 400 });

  try {
    return await withTimedConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [rows] = await connection.execute(
          `SELECT id FROM questions WHERE (id = ? OR root_id = ?) AND deleted_at IS NULL`,
          [questionId, questionId],
        );
        const ids = rows.map((row) => row.id);
        if (ids.length === 0) {
          await connection.rollback();
          return Response.json({ success: false, message: 'Question not found' }, { status: 404 });
        }

        const placeholders = ids.map(() => '?').join(',');
        await connection.query(`UPDATE choices SET deleted_at = CURRENT_TIMESTAMP WHERE question_id IN (${placeholders}) AND deleted_at IS NULL`, ids);
        await connection.query(`UPDATE answers SET deleted_at = CURRENT_TIMESTAMP WHERE question_id IN (${placeholders}) AND deleted_at IS NULL`, ids);
        await connection.query(
          `UPDATE attachments SET deleted_at = CURRENT_TIMESTAMP WHERE owner_type = ? AND owner_id IN (${placeholders}) AND deleted_at IS NULL`,
          [ATTACHMENT_OWNER_TYPES.QUESTION, ...ids],
        );
        await connection.query(`UPDATE questions SET deleted_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND deleted_at IS NULL`, ids);
        await connection.commit();
        return Response.json({ success: true, message: 'Question deleted', data: { id: questionId } });
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      }
    });
  } catch (error) {
    if (error.message === 'REQUEST_TIMEOUT') return Response.json({ success: false, message: 'Request timeout' }, { status: 504 });
    console.error('Failed to delete question:', error);
    return Response.json({ success: false, message: 'Failed to delete question' }, { status: 500 });
  }
}
