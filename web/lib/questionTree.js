export function questionSortKey(value) {
  const chunks = String(value || '').match(/\d+|[a-zA-Z]+|[^a-zA-Z\d]+/g) || [];
  return chunks.map((chunk) => /^\d+$/.test(chunk) ? chunk.padStart(10, '0') : chunk.toLowerCase()).join('');
}

export function sortQuestions(a, b) {
  const levelCompare = Number(a.q_level || 1) - Number(b.q_level || 1);
  if (levelCompare !== 0) return levelCompare;
  return questionSortKey(a.question_number).localeCompare(questionSortKey(b.question_number), 'en');
}

export function buildQuestionTree(rows, { choices = [], attachments = [], answers = [] } = {}) {
  const choiceByQuestionId = new Map(choices.map((choice) => [choice.question_id, choice]));
  const attachmentsByQuestionId = new Map();
  const answerByQuestionId = new Map(answers.map((answer) => [answer.question_id, answer]));

  for (const attachment of attachments) {
    const list = attachmentsByQuestionId.get(attachment.owner_id) || [];
    list.push(attachment);
    attachmentsByQuestionId.set(attachment.owner_id, list);
  }

  const questionById = new Map();
  for (const row of rows) {
    const question = {
      ...row,
      q_level: Number(row.q_level || 1),
      choices: choiceByQuestionId.get(row.id) || null,
      attachments: attachmentsByQuestionId.get(row.id) || [],
      image: attachmentsByQuestionId.get(row.id)?.[0] || null,
      children: [],
      subquestions: [],
      answer: answerByQuestionId.get(row.id) || null,
    };

    if (question.q_level > 1) {
      question.subquestion_number = question.question_number;
      question.subquestion_text = question.question_text;
      question.subchoices = question.choices;
    }

    questionById.set(question.id, question);
  }

  const roots = [];
  for (const question of questionById.values()) {
    if (question.parent_id && questionById.has(question.parent_id)) {
      const parent = questionById.get(question.parent_id);
      parent.children.push(question);
      parent.subquestions = parent.children;
    } else {
      roots.push(question);
    }
  }

  for (const question of questionById.values()) {
    question.children.sort(sortQuestions);
    question.subquestions = question.children;
  }

  roots.sort(sortQuestions);
  return roots;
}
