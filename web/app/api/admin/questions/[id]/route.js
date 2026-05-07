import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { getConnection } from '@/lib/db';
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

function idFromParams(params) {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

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

function countChoices(record) {
  return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].filter((key) => emptyToNull(record?.[key]) !== null).length;
}

function validateImage(file, label) {
  if (!file) return null;
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return `${label} 僅允許 jpg、png、webp`;
  if (file.size > MAX_IMAGE_SIZE) return `${label} 不可超過 1MB`;
  return null;
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

function validatePayload(payload, files, currentQuestion = null) {
  const errors = [];
  const question = payload.questions || {};
  const subquestions = payload.subquestions || [];
  const questionType = emptyToNull(question.question_type);
  const isExamQuestion = currentQuestion?.exam_id !== null && currentQuestion?.exam_id !== undefined;

  if (isExamQuestion && !emptyToNull(question.question_number)) errors.push('題號必填');
  if (!questionType) errors.push('問題類型必填');
  if (!emptyToNull(question.question_text) && !files.questionImage && subquestions.length === 0 && !question.keep_question_image) {
    errors.push('沒有子題時，題目主文或主題目圖片至少需要一項');
  }
  if (usesChoices(questionType) && countChoices(payload.choices) < 2) errors.push('選擇題至少需填寫 A、B 兩個選項');

  subquestions.forEach((subquestion, index) => {
    const label = `第 ${index + 1} 個子題`;
    const subType = emptyToNull(subquestion.question_type);
    const subImage = files.subquestionImages.get(subquestion._client_key);
    if (!emptyToNull(subquestion.subquestion_number)) errors.push(`${label} 子題號必填`);
    if (!subType) errors.push(`${label} 問題類型必填`);
    if (!emptyToNull(subquestion.subquestion_text) && !subImage && !subquestion.keep_image) {
      errors.push(`${label} 子題主文或圖片至少需要一項`);
    }
    if (usesChoices(subType)) {
      const subchoice = (payload.subchoices || []).find((item) => item._parent_subquestion_client_key === subquestion._client_key);
      if (countChoices(subchoice) < 2) errors.push(`${label} 選擇題至少需填寫 A、B 兩個選項`);
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
  assertAttachmentOwnerType(ownerType);

  await connection.execute(
    `UPDATE attachments
     SET deleted_at = CURRENT_TIMESTAMP
     WHERE owner_type = ? AND owner_id = ? AND usage_type = ? AND deleted_at IS NULL`,
    [ownerType, ownerId, ATTACHMENT_USAGE_TYPES.QUESTION_PROMPT],
  );
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

export async function GET(_request, { params }) {
  const questionId = idFromParams(await params);
  if (!questionId) return Response.json({ success: false, message: 'Invalid question id' }, { status: 400 });

  try {
    return await withTimedConnection(async (connection) => {
      const [rows] = await connection.execute(
        `SELECT q.*, e.source_kind, e.title, e.roc_year, e.university, e.department, e.division, e.subject, e.paper
         FROM questions q
         LEFT JOIN exams e ON e.id = q.exam_id
         WHERE q.id = ? AND q.deleted_at IS NULL
         LIMIT 1`,
        [questionId],
      );
      if (rows.length === 0) return Response.json({ success: false, message: 'Question not found' }, { status: 404 });

      const row = rows[0];
      const [choicesRows] = await connection.execute(`SELECT * FROM choices WHERE question_id = ? AND deleted_at IS NULL LIMIT 1`, [questionId]);
      const [questionAttachments] = await connection.execute(
        `SELECT id, owner_type, owner_id, usage_type, path, url, original_filename, mime_type
         FROM attachments WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL`,
        [ATTACHMENT_OWNER_TYPES.QUESTION, questionId],
      );
      const [subRows] = await connection.execute(
        `SELECT * FROM subquestions WHERE main_question = ? AND deleted_at IS NULL ORDER BY subquestion_number, id`,
        [questionId],
      );
      const subquestions = [];
      for (const sub of subRows) {
        const [subchoiceRows] = await connection.execute(`SELECT * FROM subchoices WHERE subquestion_id = ? AND deleted_at IS NULL LIMIT 1`, [sub.id]);
        const [subAttachments] = await connection.execute(
          `SELECT id, owner_type, owner_id, usage_type, path, url, original_filename, mime_type
           FROM attachments WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL`,
          [ATTACHMENT_OWNER_TYPES.SUBQUESTION, sub.id],
        );
        subquestions.push({ ...sub, subchoices: subchoiceRows[0] || null, attachments: subAttachments, image: subAttachments[0] || null });
      }

      const exam = {
        id: row.exam_id,
        source_kind: row.source_kind,
        title: row.title,
        roc_year: row.roc_year,
        university: row.university,
        department: row.department,
        division: row.division,
        subject: row.subject,
        paper: row.paper,
      };

      return Response.json(
        {
          success: true,
          data: {
            exam: { ...exam, display_name: exam.title || '' },
            question: {
              id: row.id,
              question_number: row.question_number,
              question_text: row.question_text,
              exam_id: row.exam_id,
              score: row.score,
              question_type: row.question_type,
              difficulty: row.difficulty,
              source: row.source,
              note: row.note,
              choices: choicesRows[0] || null,
              attachments: questionAttachments,
              image: questionAttachments[0] || null,
              subquestions,
            },
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
        const question = payload.questions;
        const [currentRows] = await connection.execute(
          `SELECT id, exam_id
           FROM questions
           WHERE id = ? AND deleted_at IS NULL
           LIMIT 1`,
          [questionId],
        );

        if (currentRows.length === 0) {
          await connection.rollback();
          return Response.json({ success: false, message: 'Question not found' }, { status: 404 });
        }

        const validationErrors = validatePayload(payload, files, currentRows[0]);
        if (validationErrors.length > 0) {
          await connection.rollback();
          return Response.json({ success: false, message: 'Validation failed', errors: validationErrors }, { status: 422 });
        }

        await connection.execute(
          `UPDATE questions
           SET question_number = ?, question_text = ?, score = ?, question_type = ?, difficulty = ?, source = ?, note = ?
           WHERE id = ? AND deleted_at IS NULL`,
          [
            emptyToNull(question.question_number),
            emptyToNull(question.question_text),
            numberOrNull(question.score),
            emptyToNull(question.question_type),
            emptyToNull(question.difficulty),
            emptyToNull(question.source),
            emptyToNull(question.note),
            questionId,
          ],
        );

        await connection.execute(`UPDATE choices SET deleted_at = CURRENT_TIMESTAMP WHERE question_id = ? AND deleted_at IS NULL`, [questionId]);
        if (usesChoices(emptyToNull(question.question_type))) {
          const choices = payload.choices || {};
          await connection.execute(
            `INSERT INTO choices (question_id, A, B, C, D, E, F, G, H) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [questionId, ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((key) => emptyToNull(choices[key]))],
          );
        }

        if (payload.delete_question_image || files.questionImage) await softDeleteAttachments(connection, ATTACHMENT_OWNER_TYPES.QUESTION, questionId);
        if (files.questionImage) {
          const stored = await storeImage(files.questionImage, ATTACHMENT_OWNER_TYPES.QUESTION, questionId);
          uploadedPaths.push(stored.absolutePath);
          await insertAttachment(connection, ATTACHMENT_OWNER_TYPES.QUESTION, questionId, ATTACHMENT_USAGE_TYPES.QUESTION_PROMPT, stored.record);
        }

        const existingSubIds = new Set();
        const clientKeyToId = new Map();
        for (const subquestion of payload.subquestions || []) {
          let subquestionId = Number(subquestion.id || 0);
          if (subquestionId > 0) {
            await connection.execute(
              `UPDATE subquestions
               SET subquestion_number = ?, subquestion_text = ?, score = ?, question_type = ?
               WHERE id = ? AND main_question = ? AND deleted_at IS NULL`,
              [
                emptyToNull(subquestion.subquestion_number),
                emptyToNull(subquestion.subquestion_text),
                numberOrNull(subquestion.score),
                emptyToNull(subquestion.question_type),
                subquestionId,
                questionId,
              ],
            );
          } else {
            const [result] = await connection.execute(
              `INSERT INTO subquestions (subquestion_number, subquestion_text, main_question, score, question_type)
               VALUES (?, ?, ?, ?, ?)`,
              [
                emptyToNull(subquestion.subquestion_number),
                emptyToNull(subquestion.subquestion_text),
                questionId,
                numberOrNull(subquestion.score),
                emptyToNull(subquestion.question_type),
              ],
            );
            subquestionId = result.insertId;
          }
          existingSubIds.add(subquestionId);
          clientKeyToId.set(subquestion._client_key, subquestionId);

          if (subquestion.delete_image || files.subquestionImages.get(subquestion._client_key)) {
            await softDeleteAttachments(connection, ATTACHMENT_OWNER_TYPES.SUBQUESTION, subquestionId);
          }
          const subImage = files.subquestionImages.get(subquestion._client_key);
          if (subImage) {
            const stored = await storeImage(subImage, ATTACHMENT_OWNER_TYPES.SUBQUESTION, subquestionId);
            uploadedPaths.push(stored.absolutePath);
            await insertAttachment(connection, ATTACHMENT_OWNER_TYPES.SUBQUESTION, subquestionId, ATTACHMENT_USAGE_TYPES.QUESTION_PROMPT, stored.record);
          }
        }

        const [currentSubs] = await connection.execute(
          `SELECT id FROM subquestions WHERE main_question = ? AND deleted_at IS NULL`,
          [questionId],
        );
        for (const sub of currentSubs) {
          if (!existingSubIds.has(sub.id)) {
            await connection.execute(`UPDATE subchoices SET deleted_at = CURRENT_TIMESTAMP WHERE subquestion_id = ? AND deleted_at IS NULL`, [sub.id]);
            await softDeleteAttachments(connection, ATTACHMENT_OWNER_TYPES.SUBQUESTION, sub.id);
            await connection.execute(`UPDATE subquestions SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [sub.id]);
          }
        }

        for (const subquestionId of existingSubIds) {
          await connection.execute(`UPDATE subchoices SET deleted_at = CURRENT_TIMESTAMP WHERE subquestion_id = ? AND deleted_at IS NULL`, [subquestionId]);
        }

        for (const subchoice of payload.subchoices || []) {
          const subquestionId = clientKeyToId.get(subchoice._parent_subquestion_client_key);
          if (!subquestionId) continue;
          await connection.execute(
            `INSERT INTO subchoices (subquestion_id, A, B, C, D, E, F, G, H) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [subquestionId, ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((key) => emptyToNull(subchoice[key]))],
          );
        }

        await connection.commit();
        return Response.json({ success: true, message: 'Question updated', data: { id: questionId } });
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      }
    });
  } catch (error) {
    for (const uploadedPath of uploadedPaths) await unlink(uploadedPath).catch(() => {});
    if (error.message === 'REQUEST_TIMEOUT') return Response.json({ success: false, message: 'Request timeout' }, { status: 504 });
    console.error('Failed to update question:', error);
    return Response.json({ success: false, message: 'Failed to update question' }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  const questionId = idFromParams(await params);
  if (!questionId) return Response.json({ success: false, message: 'Invalid question id' }, { status: 400 });

  try {
    return await withTimedConnection(async (connection) => {
      await connection.beginTransaction();
      try {
        const [subs] = await connection.execute(`SELECT id FROM subquestions WHERE main_question = ? AND deleted_at IS NULL`, [questionId]);
        await connection.execute(`UPDATE choices SET deleted_at = CURRENT_TIMESTAMP WHERE question_id = ? AND deleted_at IS NULL`, [questionId]);
        await connection.execute(`UPDATE answers SET deleted_at = CURRENT_TIMESTAMP WHERE question_id = ? AND deleted_at IS NULL`, [questionId]);
        await softDeleteAttachments(connection, ATTACHMENT_OWNER_TYPES.QUESTION, questionId);
        for (const sub of subs) {
          await connection.execute(`UPDATE subchoices SET deleted_at = CURRENT_TIMESTAMP WHERE subquestion_id = ? AND deleted_at IS NULL`, [sub.id]);
          await softDeleteAttachments(connection, ATTACHMENT_OWNER_TYPES.SUBQUESTION, sub.id);
        }
        await connection.execute(`UPDATE subquestions SET deleted_at = CURRENT_TIMESTAMP WHERE main_question = ? AND deleted_at IS NULL`, [questionId]);
        await connection.execute(`UPDATE questions SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`, [questionId]);
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
