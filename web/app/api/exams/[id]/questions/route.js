import { databaseErrorMessage, getConnection } from '@/lib/db';
import { buildQuestionTree } from '@/lib/questionTree';
import { ATTACHMENT_OWNER_TYPES } from '@/server/attachments/attachmentConstants';

export const runtime = 'nodejs';

const DB_OPERATION_TIMEOUT_MS = 55000;

function examIdFromParams(params) {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function fetchQuestionRelatedRows(connection, questionIds) {
  if (questionIds.length === 0) {
    return { choices: [], attachments: [], answers: [] };
  }

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
  const [answers] = await connection.query(
    `SELECT id, question_id
     FROM answers
     WHERE question_id IN (${placeholders}) AND deleted_at IS NULL`,
    questionIds,
  );

  return { choices, attachments, answers };
}

export async function GET(_request, { params }) {
  const examId = examIdFromParams(await params);
  if (!examId) {
    return Response.json({ success: false, message: 'Invalid exam id' }, { status: 400 });
  }

  let connection;
  let timedOut = false;
  let timeoutId;

  try {
    connection = await getConnection();
    timeoutId = setTimeout(() => {
      timedOut = true;
      connection.destroy();
    }, DB_OPERATION_TIMEOUT_MS);

    const [examRows] = await connection.execute(
      `SELECT id, source_kind, title, source, roc_year, university, department, division, subject, paper
       FROM exams
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [examId],
    );

    if (examRows.length === 0) {
      return Response.json({ success: false, message: 'Exam not found' }, { status: 404 });
    }

    const [questionRows] = await connection.execute(
      `SELECT id, question_number, question_text, exam_id, parent_id, q_level, root_id,
              score, question_type, difficulty, source, note
       FROM questions
       WHERE exam_id = ? AND deleted_at IS NULL`,
      [examId],
    );

    const questionIds = questionRows.map((row) => row.id);
    const related = await fetchQuestionRelatedRows(connection, questionIds);
    const questions = buildQuestionTree(questionRows, related);

    return Response.json(
      {
        success: true,
        data: {
          exam: {
            ...examRows[0],
            display_name: examRows[0].title,
          },
          questions,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (timedOut) {
      return Response.json(
        {
          success: false,
          message: 'Request timeout. Please try again later.',
        },
        { status: 504 },
      );
    }

    console.error('Failed to fetch exam questions:', error);
    const message = databaseErrorMessage(error) || 'Failed to fetch exam questions';
    return Response.json({ success: false, message }, { status: 500 });
  } finally {
    clearTimeout(timeoutId);
    if (connection && !timedOut) {
      connection.release();
    }
  }
}
