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
  return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].filter((key) => emptyToNull(record?.[key]) !== null).length;
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
  const subquestions = payload.subquestions || [];
  const questionType = emptyToNull(question.question_type);
  const examId = numberOrNull(question.exam_id);

  if (examId && !emptyToNull(question.question_number)) errors.push('題號必填');
  if (!questionType) errors.push('問題類型必填');
  if (!emptyToNull(question.question_text) && !files.questionImage && subquestions.length === 0) {
    errors.push('沒有子題時，題目主文或主題目圖片至少需要一項');
  }
  if (usesChoices(questionType) && countChoiceValues(payload.choices) < 2) {
    errors.push('選擇題至少需填寫 A、B 兩個選項');
  }

  subquestions.forEach((subquestion, index) => {
    const label = `第 ${index + 1} 個子題`;
    const subType = emptyToNull(subquestion.question_type);
    const subImage = files.subquestionImages.get(subquestion._client_key);
    if (!emptyToNull(subquestion.subquestion_number)) errors.push(`${label} 子題號必填`);
    if (!subType) errors.push(`${label} 問題類型必填`);
    if (!emptyToNull(subquestion.subquestion_text) && !subImage) {
      errors.push(`${label} 子題主文或圖片至少需要一項`);
    }
    if (usesChoices(subType)) {
      const subchoice = (payload.subchoices || []).find((item) => item._parent_subquestion_client_key === subquestion._client_key);
      if (countChoiceValues(subchoice) < 2) errors.push(`${label} 選擇題至少需填寫 A、B 兩個選項`);
    }
  });

  const questionImageError = validateImage(files.questionImage, '主題目圖片');
  if (questionImageError) errors.push(questionImageError);
  for (const [clientKey, file] of files.subquestionImages.entries()) {
    const imageError = validateImage(file, `子題圖片 ${clientKey}`);
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
  const subquestionImages = new Map();
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('subquestion_image__') && value instanceof File && value.size > 0) {
      subquestionImages.set(key.replace('subquestion_image__', ''), value);
    }
  }
  return {
    questionImage: questionImage instanceof File && questionImage.size > 0 ? questionImage : null,
    subquestionImages,
  };
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
    const [questionResult] = await connection.execute(
      `INSERT INTO questions (
        question_number, question_text, exam_id, score, question_type, difficulty, source, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        emptyToNull(question.question_number),
        emptyToNull(question.question_text),
        numberOrNull(question.exam_id),
        numberOrNull(question.score),
        emptyToNull(question.question_type),
        emptyToNull(question.difficulty),
        emptyToNull(question.source),
        emptyToNull(question.note),
      ],
    );
    const questionId = questionResult.insertId;

    if (usesChoices(emptyToNull(question.question_type))) {
      const choices = payload.choices || {};
      await connection.execute(
        `INSERT INTO choices (question_id, A, B, C, D, E, F, G, H)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [questionId, ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((key) => emptyToNull(choices[key]))],
      );
    }

    if (files.questionImage) {
      const stored = await storeImage(files.questionImage, ATTACHMENT_OWNER_TYPES.QUESTION, questionId);
      uploadedPaths.push(stored.absolutePath);
      await insertAttachment(connection, ATTACHMENT_OWNER_TYPES.QUESTION, questionId, ATTACHMENT_USAGE_TYPES.QUESTION_PROMPT, stored.record);
    }

    const subquestionIdByClientKey = new Map();
    for (const subquestion of payload.subquestions || []) {
      const [subResult] = await connection.execute(
        `INSERT INTO subquestions (
          subquestion_number, subquestion_text, main_question, score, question_type
        ) VALUES (?, ?, ?, ?, ?)`,
        [
          emptyToNull(subquestion.subquestion_number),
          emptyToNull(subquestion.subquestion_text),
          questionId,
          numberOrNull(subquestion.score),
          emptyToNull(subquestion.question_type),
        ],
      );
      const subquestionId = subResult.insertId;
      subquestionIdByClientKey.set(subquestion._client_key, subquestionId);

      const subImage = files.subquestionImages.get(subquestion._client_key);
      if (subImage) {
        const stored = await storeImage(subImage, ATTACHMENT_OWNER_TYPES.SUBQUESTION, subquestionId);
        uploadedPaths.push(stored.absolutePath);
        await insertAttachment(connection, ATTACHMENT_OWNER_TYPES.SUBQUESTION, subquestionId, ATTACHMENT_USAGE_TYPES.QUESTION_PROMPT, stored.record);
      }
    }

    for (const subchoice of payload.subchoices || []) {
      const subquestionId = subquestionIdByClientKey.get(subchoice._parent_subquestion_client_key);
      if (!subquestionId) throw new Error('Missing subquestion id for subchoice');
      await connection.execute(
        `INSERT INTO subchoices (subquestion_id, A, B, C, D, E, F, G, H)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [subquestionId, ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((key) => emptyToNull(subchoice[key]))],
      );
    }

    await connection.commit();

    return Response.json(
      {
        success: true,
        message: 'Question created',
        data: {
          id: questionId,
          redirect_to: numberOrNull(question.exam_id)
            ? `/prototype/exam-questions.html?exam_id=${numberOrNull(question.exam_id)}`
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
