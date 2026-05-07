import { getConnection } from '@/lib/db';
import { ATTACHMENT_OWNER_TYPES } from '@/server/attachments/attachmentConstants';

export const runtime = 'nodejs';

const DB_OPERATION_TIMEOUT_MS = 55000;

function examIdFromParams(params) {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sortKey(value) {
  const chunks = String(value || '').match(/\d+|[a-zA-Z]+|[^a-zA-Z\d]+/g) || [];
  return chunks.map((chunk) => /^\d+$/.test(chunk) ? chunk.padStart(10, '0') : chunk.toLowerCase()).join('');
}

export async function GET(_request, { params }) {
  const examId = examIdFromParams(await params);
  if (!examId) {
    return Response.json({ success: false, message: 'Invalid exam id' }, { status: 400 });
  }

  const connection = await getConnection();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    connection.destroy();
  }, DB_OPERATION_TIMEOUT_MS);

  try {
    const [examRows] = await connection.execute(
      `SELECT id, source_kind, title, roc_year, university, department, division, subject, paper
       FROM exams
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [examId],
    );

    if (examRows.length === 0) {
      return Response.json({ success: false, message: 'Exam not found' }, { status: 404 });
    }

    const [questionRows] = await connection.execute(
      `SELECT id, question_number, question_text, exam_id, score, question_type, difficulty, source, note
       FROM questions
       WHERE exam_id = ? AND deleted_at IS NULL`,
      [examId],
    );

    const questionIds = questionRows.map((row) => row.id);
    const questions = questionRows
      .sort((a, b) => sortKey(a.question_number).localeCompare(sortKey(b.question_number), 'en'))
      .map((row) => ({
        ...row,
        choices: null,
        attachments: [],
        subquestions: [],
        answer: null,
      }));

    if (questionIds.length > 0) {
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
      const [subquestions] = await connection.query(
        `SELECT id, subquestion_number, subquestion_text, main_question, score, question_type
         FROM subquestions
         WHERE main_question IN (${placeholders}) AND deleted_at IS NULL`,
        questionIds,
      );
      const [answers] = await connection.query(
        `SELECT id, question_id
         FROM answers
         WHERE question_id IN (${placeholders}) AND deleted_at IS NULL`,
        questionIds,
      );

      const subquestionIds = subquestions.map((row) => row.id);
      const subMap = new Map(subquestions.map((row) => [row.id, { ...row, subchoices: null, attachments: [] }]));

      if (subquestionIds.length > 0) {
        const subPlaceholders = subquestionIds.map(() => '?').join(',');
        const [subchoices] = await connection.query(
          `SELECT * FROM subchoices WHERE subquestion_id IN (${subPlaceholders}) AND deleted_at IS NULL`,
          subquestionIds,
        );
        const [subAttachments] = await connection.query(
          `SELECT id, owner_type, owner_id, usage_type, path, url, original_filename, mime_type, width, height
           FROM attachments
           WHERE owner_type = ? AND owner_id IN (${subPlaceholders}) AND deleted_at IS NULL
           ORDER BY display_order, id`,
          [ATTACHMENT_OWNER_TYPES.SUBQUESTION, ...subquestionIds],
        );

        for (const choice of subchoices) {
          const sub = subMap.get(choice.subquestion_id);
          if (sub) sub.subchoices = choice;
        }
        for (const attachment of subAttachments) {
          const sub = subMap.get(attachment.owner_id);
          if (sub) sub.attachments.push(attachment);
        }
      }

      const questionMap = new Map(questions.map((row) => [row.id, row]));
      for (const choice of choices) {
        const question = questionMap.get(choice.question_id);
        if (question) question.choices = choice;
      }
      for (const attachment of attachments) {
        const question = questionMap.get(attachment.owner_id);
        if (question) question.attachments.push(attachment);
      }
      for (const sub of subMap.values()) {
        const question = questionMap.get(sub.main_question);
        if (question) question.subquestions.push(sub);
      }
      for (const answer of answers) {
        const question = questionMap.get(answer.question_id);
        if (question) question.answer = answer;
      }
      for (const question of questions) {
        question.subquestions.sort((a, b) => sortKey(a.subquestion_number).localeCompare(sortKey(b.subquestion_number), 'en'));
      }
    }

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
    return Response.json({ success: false, message: 'Failed to fetch exam questions' }, { status: 500 });
  } finally {
    clearTimeout(timeoutId);
    if (!timedOut) {
      connection.release();
    }
  }
}
