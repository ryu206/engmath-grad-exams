import { databaseErrorMessage, getConnection } from '@/lib/db';
import { ATTACHMENT_OWNER_TYPES } from '@/server/attachments/attachmentConstants';

export const runtime = 'nodejs';

const DB_OPERATION_TIMEOUT_MS = 55000;

function sortKey(value) {
  const chunks = String(value || '').match(/\d+|[a-zA-Z]+|[^a-zA-Z\d]+/g) || [];
  return chunks.map((chunk) => /^\d+$/.test(chunk) ? chunk.padStart(10, '0') : chunk.toLowerCase()).join('');
}

function normalizeQuestions(rows) {
  return rows
    .sort((a, b) => sortKey(a.question_number).localeCompare(sortKey(b.question_number), 'en'))
    .map((row) => ({
      ...row,
      choices: null,
      attachments: [],
      subquestions: [],
      answer: null,
    }));
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

async function fetchQuestionDetail(connection, questionId) {
  const [questionRows] = await connection.execute(
    `SELECT q.id, q.question_number, q.question_text, q.exam_id, q.score, q.question_type, q.difficulty, q.source, q.note,
            e.source_kind, e.title, e.roc_year, e.university, e.department, e.division, e.subject, e.paper
     FROM questions q
     LEFT JOIN exams e ON e.id = q.exam_id
     WHERE q.id = ? AND q.deleted_at IS NULL
     LIMIT 1`,
    [questionId],
  );

  if (questionRows.length === 0) {
    return Response.json({ success: false, message: 'Question not found' }, { status: 404 });
  }

  const row = questionRows[0];
  const [choicesRows] = await connection.execute(
    `SELECT * FROM choices WHERE question_id = ? AND deleted_at IS NULL LIMIT 1`,
    [questionId],
  );
  const [questionAttachments] = await connection.execute(
    `SELECT id, owner_type, owner_id, usage_type, path, url, original_filename, mime_type, width, height
     FROM attachments
     WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL
     ORDER BY display_order, id`,
    [ATTACHMENT_OWNER_TYPES.QUESTION, questionId],
  );
  const [subRows] = await connection.execute(
    `SELECT id, subquestion_number, subquestion_text, main_question, score, question_type
     FROM subquestions
     WHERE main_question = ? AND deleted_at IS NULL
     ORDER BY subquestion_number, id`,
    [questionId],
  );

  const subquestions = [];
  for (const sub of subRows) {
    const [subchoiceRows] = await connection.execute(
      `SELECT * FROM subchoices WHERE subquestion_id = ? AND deleted_at IS NULL LIMIT 1`,
      [sub.id],
    );
    const [subAttachments] = await connection.execute(
      `SELECT id, owner_type, owner_id, usage_type, path, url, original_filename, mime_type, width, height
       FROM attachments
       WHERE owner_type = ? AND owner_id = ? AND deleted_at IS NULL
       ORDER BY display_order, id`,
      [ATTACHMENT_OWNER_TYPES.SUBQUESTION, sub.id],
    );
    subquestions.push({
      ...sub,
      subchoices: subchoiceRows[0] || null,
      attachments: subAttachments,
      image: subAttachments[0] || null,
    });
  }

  const [answerRows] = await connection.execute(
    `SELECT id, short_answer, answer_text, question_id, source, note, created_at, updated_at
     FROM answers
     WHERE question_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [questionId],
  );
  let answer = answerRows[0] || null;
  if (answer) {
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
  }

  const exam = row.exam_id
    ? {
        id: row.exam_id,
        source_kind: row.source_kind,
        title: row.title,
        roc_year: row.roc_year,
        university: row.university,
        department: row.department,
        division: row.division,
        subject: row.subject,
        paper: row.paper,
        display_name: row.title || '',
      }
    : null;

  return Response.json(
    {
      success: true,
      data: {
        exam,
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
      `SELECT id, question_number, question_text, exam_id, score, question_type, difficulty, source, note
       FROM questions
       WHERE exam_id IS NULL AND deleted_at IS NULL`,
    );

    const questionIds = questionRows.map((row) => row.id);
    const questions = normalizeQuestions(questionRows);

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
