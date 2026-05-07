# Standalone Questions

## Decision

Standalone questions are regular `questions` rows where:

```text
questions.exam_id IS NULL
```

They do not use `exam_id = 0`, and they do not use a fake row in `exams`.

Standalone questions may also leave `questions.question_number` as `NULL`. Exam-attached questions should still provide a question number for exam-page ordering and display.

## Pages

```text
/prototype/independent-question-create.html
/prototype/questions.html?standalone=1
/prototype/independent-questions.html
```

The fixed create page redirects to the shared question form with `standalone=1`. This avoids maintaining a second copy of the full question-entry form.

## APIs

```text
POST /api/admin/questions
GET /api/questions?scope=standalone
```

`POST /api/admin/questions` accepts `exam_id = null`. When the created question has no exam, the API redirects to:

```text
/prototype/independent-questions.html
```

`GET /api/questions?scope=standalone` only returns:

```sql
WHERE questions.exam_id IS NULL
  AND questions.deleted_at IS NULL
```

Exam question browsing remains separate:

```text
GET /api/exams/{id}/questions
WHERE questions.exam_id = exams.id
```

## Coupling Rules

- Do not use `exam_id = 0`.
- Do not create a fake "standalone exam".
- Do not mix standalone questions into `/prototype/exam-questions.html`.
- Use `NULL` as the only meaning for "not attached to an exam".
- Keep the standalone create flow on the shared question form unless the field set truly diverges.

## Future Expansion

If standalone questions later need to be assigned to exams, update the question edit flow to allow changing:

```text
questions.exam_id NULL -> exams.id
questions.exam_id exams.id -> NULL
```

That should be an explicit edit action, not an implicit side effect of browsing or creating.
