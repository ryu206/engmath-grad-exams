USE engineering_math_bank;

ALTER TABLE questions
  ADD COLUMN parent_id INT UNSIGNED NULL AFTER exam_id,
  ADD COLUMN q_level TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER parent_id,
  ADD COLUMN root_id INT UNSIGNED NULL AFTER q_level,
  ADD COLUMN legacy_subquestion_id INT UNSIGNED NULL AFTER root_id;

UPDATE questions
SET
  parent_id = NULL,
  q_level = 1,
  root_id = id
WHERE parent_id IS NULL;

INSERT INTO questions (
  question_number,
  question_text,
  exam_id,
  parent_id,
  q_level,
  root_id,
  score,
  question_type,
  difficulty,
  source,
  note,
  created_at,
  updated_at,
  deleted_at,
  legacy_subquestion_id
)
SELECT
  sq.subquestion_number,
  sq.subquestion_text,
  q.exam_id,
  sq.main_question,
  2,
  q.root_id,
  sq.score,
  sq.question_type,
  NULL,
  NULL,
  NULL,
  sq.created_at,
  sq.updated_at,
  sq.deleted_at,
  sq.id
FROM subquestions sq
JOIN questions q ON q.id = sq.main_question;

INSERT INTO choices (
  question_id,
  A,
  B,
  C,
  D,
  E,
  F,
  G,
  H,
  created_at,
  updated_at,
  deleted_at
)
SELECT
  q.id,
  sc.A,
  sc.B,
  sc.C,
  sc.D,
  sc.E,
  sc.F,
  sc.G,
  sc.H,
  sc.created_at,
  sc.updated_at,
  sc.deleted_at
FROM subchoices sc
JOIN questions q ON q.legacy_subquestion_id = sc.subquestion_id;

UPDATE attachments a
JOIN questions q ON q.legacy_subquestion_id = a.owner_id
SET
  a.owner_type = 'question',
  a.owner_id = q.id
WHERE a.owner_type = 'subquestion';

ALTER TABLE questions
  DROP COLUMN legacy_subquestion_id,
  ADD INDEX idx_questions_parent (parent_id, deleted_at, question_number),
  ADD INDEX idx_questions_root (root_id, deleted_at, q_level, question_number),
  DROP INDEX idx_questions_exam_list,
  ADD INDEX idx_questions_exam_list (exam_id, deleted_at, q_level, question_number),
  ADD CONSTRAINT fk_questions_parent
    FOREIGN KEY (parent_id) REFERENCES questions (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  ADD CONSTRAINT fk_questions_root
    FOREIGN KEY (root_id) REFERENCES questions (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  ADD CONSTRAINT chk_questions_q_level
    CHECK (q_level IN (1, 2, 3)),
  ADD CONSTRAINT chk_questions_root_shape
    CHECK (
      (q_level = 1 AND parent_id IS NULL)
      OR (q_level IN (2, 3) AND parent_id IS NOT NULL AND root_id IS NOT NULL)
    );

DROP TABLE subchoices;
DROP TABLE subquestions;
