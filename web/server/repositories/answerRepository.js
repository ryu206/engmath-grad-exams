function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

export async function findActiveAnswerByQuestionId(connection, questionId) {
  const [rows] = await connection.execute(
    `SELECT id, short_answer, answer_text, question_id, source, note, created_at, updated_at
     FROM answers
     WHERE question_id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [questionId],
  );

  return rows[0] || null;
}

export async function findActiveAnswerById(connection, answerId) {
  const [rows] = await connection.execute(
    `SELECT id, short_answer, answer_text, question_id, source, note, created_at, updated_at
     FROM answers
     WHERE id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [answerId],
  );

  return rows[0] || null;
}

export async function insertAnswer(connection, answer) {
  const [result] = await connection.execute(
    `INSERT INTO answers (short_answer, answer_text, question_id, source, note)
     VALUES (?, ?, ?, ?, ?)`,
    [
      emptyToNull(answer.short_answer),
      emptyToNull(answer.answer_text),
      Number(answer.question_id),
      emptyToNull(answer.source),
      emptyToNull(answer.note),
    ],
  );

  return result.insertId;
}

export async function updateAnswer(connection, answerId, answer) {
  await connection.execute(
    `UPDATE answers
     SET short_answer = ?, answer_text = ?, source = ?, note = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [
      emptyToNull(answer.short_answer),
      emptyToNull(answer.answer_text),
      emptyToNull(answer.source),
      emptyToNull(answer.note),
      answerId,
    ],
  );
}

export async function softDeleteAnswer(connection, answerId) {
  await connection.execute(
    `UPDATE answers
     SET deleted_at = CURRENT_TIMESTAMP
     WHERE id = ? AND deleted_at IS NULL`,
    [answerId],
  );
}
