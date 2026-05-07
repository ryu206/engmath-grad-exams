USE engineering_math_bank;

SELECT a.*
FROM attachments a
LEFT JOIN questions q
  ON a.owner_type = 'question'
  AND a.owner_id = q.id
  AND q.deleted_at IS NULL
LEFT JOIN subquestions sq
  ON a.owner_type = 'subquestion'
  AND a.owner_id = sq.id
  AND sq.deleted_at IS NULL
LEFT JOIN answers ans
  ON a.owner_type = 'answer'
  AND a.owner_id = ans.id
  AND ans.deleted_at IS NULL
WHERE a.deleted_at IS NULL
  AND (
    (a.owner_type = 'question' AND q.id IS NULL)
    OR (a.owner_type = 'subquestion' AND sq.id IS NULL)
    OR (a.owner_type = 'answer' AND ans.id IS NULL)
  );
