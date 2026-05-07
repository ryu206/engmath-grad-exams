export async function findActiveQuestionById(connection, questionId) {
  const [rows] = await connection.execute(
    `SELECT id, exam_id, question_number, question_text
     FROM questions
     WHERE id = ? AND deleted_at IS NULL
     LIMIT 1`,
    [questionId],
  );

  return rows[0] || null;
}
