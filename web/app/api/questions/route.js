import { databaseErrorMessage, getConnection } from '@/lib/db';
import { buildQuestionTree } from '@/lib/questionTree';
import { ATTACHMENT_OWNER_TYPES } from '@/server/attachments/attachmentConstants';

export const runtime = 'nodejs';

const DB_OPERATION_TIMEOUT_MS = 55000;

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
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

async function fetchAnswerDetail(connection, questionId) {
  const [answerRows] = await connection.execute(
    `SELECT id, short_answer, answer_text, question_id, source, note, created_at, updated_at
     FROM answers
     WHERE question_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [questionId],
  );

  let answer = answerRows[0] || null;
  if (!answer) return null;

  const [answerAttachments] = await connection.execute(
    `SELECT id, owner_type, owner_id, usage_type, path, url, original_filename, mime_type, width, height
     FROM attachments
     WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL
     ORDER BY display_order, id`,
    [ATTACHMENT_OWNER_TYPES.ANSWER, answer.id],
  );

  answer = {
    ...answer,
    attachments: answerAttachments,
    image: answerAttachments[0] || null,
  };

  return answer;
}

async function fetchQuestionDetail(connection, questionId) {
  const [questionRows] = await connection.execute(
    `SELECT q.id, q.question_number, q.question_text, q.exam_id, q.parent_id, q.q_level, q.root_id,
            q.score, q.question_type, q.difficulty, q.source, q.note,
            e.source_kind, e.title, e.source AS exam_source, e.roc_year, e.university, e.department, e.division, e.subject, e.paper
     FROM questions q
     LEFT JOIN exams e ON e.id = q.exam_id
     WHERE q.id = ? AND q.deleted_at IS NULL
     LIMIT 1`,
    [questionId],
  );

  if (questionRows.length === 0) {
    return Response.json({ success: false, message: 'Question not found' }, { status: 404 });
  }

  const selected = questionRows[0];
  const rootId = selected.root_id || selected.id;
  const [treeRows] = await connection.execute(
    `SELECT id, question_number, question_text, exam_id, parent_id, q_level, root_id,
            score, question_type, difficulty, source, note
     FROM questions
     WHERE (id = ? OR root_id = ?) AND deleted_at IS NULL`,
    [rootId, rootId],
  );

  const questionIds = treeRows.map((row) => row.id);
  const related = await fetchQuestionRelatedRows(connection, questionIds);
  const questions = buildQuestionTree(treeRows, related);
  const question = questions[0] || null;
  const answer = await fetchAnswerDetail(connection, rootId);

  const exam = selected.exam_id
    ? {
        id: selected.exam_id,
        source_kind: selected.source_kind,
        title: selected.title,
        source: selected.exam_source,
        roc_year: selected.roc_year,
        university: selected.university,
        department: selected.department,
        division: selected.division,
        subject: selected.subject,
        paper: selected.paper,
        display_name: selected.title || '',
      }
    : null;

  return Response.json(
    {
      success: true,
      data: {
        exam,
        question,
        answer,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const questionId = positiveInteger(searchParams.get('id'));
  const scope = searchParams.get('scope') || 'standalone';

  if (scope !== 'standalone') {
    return Response.json({ success: false, message: 'Unsupported question scope' }, { status: 400 });
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

    if (questionId) {
      return await fetchQuestionDetail(connection, questionId);
    }

    const [questionRows] = await connection.execute(
      `SELECT id, question_number, question_text, exam_id, parent_id, q_level, root_id,
              score, question_type, difficulty, source, note
       FROM questions
       WHERE exam_id IS NULL AND deleted_at IS NULL`,
    );

    const questionIds = questionRows.map((row) => row.id);
    const related = await fetchQuestionRelatedRows(connection, questionIds);
    const questions = buildQuestionTree(questionRows, related);

    return Response.json(
      {
        success: true,
        data: {
          scope: 'standalone',
          questions,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (timedOut) {
      return Response.json({ success: false, message: 'Request timeout. Please try again later.' }, { status: 504 });
    }

    console.error('Failed to fetch standalone questions:', error);
    const message = databaseErrorMessage(error) || 'Failed to fetch standalone questions';
    return Response.json({ success: false, message }, { status: 500 });
  } finally {
    clearTimeout(timeoutId);
    if (connection && !timedOut) {
      connection.release();
    }
  }
}
