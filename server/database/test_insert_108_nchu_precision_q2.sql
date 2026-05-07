SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET collation_connection = 'utf8mb4_unicode_ci';
SET time_zone = '+00:00';

START TRANSACTION;

SET @roc_year = 108;
SET @university = '中興';
SET @department = '精密';
SET @division = NULL;
SET @subject = '工程數學';
SET @paper = NULL;
SET @title = CONCAT_WS('', @roc_year, @university, @department, @division, @subject, @paper);

SELECT id
INTO @exam_id
FROM exams
WHERE roc_year = @roc_year
  AND university = @university
  AND department = @department
  AND (division <=> @division)
  AND subject = @subject
  AND (paper <=> @paper)
  AND deleted_at IS NULL
ORDER BY id
LIMIT 1;

INSERT INTO exams (
  source_kind,
  title,
  roc_year,
  university,
  department,
  division,
  subject,
  paper
)
SELECT
  'graduate_exam',
  @title,
  @roc_year,
  @university,
  @department,
  @division,
  @subject,
  @paper
WHERE @exam_id IS NULL;

SET @exam_id = IF(@exam_id IS NULL, LAST_INSERT_ID(), @exam_id);

SET @question_number = '2';
SET @question_text = 'Solve the initial value problem
\\[
y'''' - 2y = x^2 - 1, 
\\quad  y(1)=3,\\quad y''(1)=-5
\\]';
SET @question_source = '中興精密 108-114 工程數學歷屆詳解';

SELECT id
INTO @question_id
FROM questions
WHERE exam_id = @exam_id
  AND question_number = @question_number
  AND question_text = @question_text
  AND deleted_at IS NULL
ORDER BY id
LIMIT 1;

INSERT INTO questions (
  question_number,
  question_text,
  exam_id,
  score,
  question_type,
  difficulty,
  source,
  note
)
SELECT
  @question_number,
  @question_text,
  @exam_id,
  20.00,
  'calculation',
  NULL,
  @question_source,
  NULL
WHERE @question_id IS NULL;

SET @question_id = IF(@question_id IS NULL, LAST_INSERT_ID(), @question_id);

SET @answer_text = '\\[
y(x)
=
\\frac{1}{4}\\left(7+4\\sqrt{2}\\right)e^{-\\sqrt{2}\\,x}
-
\\frac{1}{4}\\left(4\\sqrt{2}-7\\right)e^{-\\sqrt{2}} e^{\\sqrt{2}\\,x}
-
\\frac{x^2}{2}
\\]';

SELECT id
INTO @answer_id
FROM answers
WHERE question_id = @question_id
  AND deleted_at IS NULL
ORDER BY id
LIMIT 1;

INSERT INTO answers (
  short_answer,
  answer_text,
  question_id,
  source,
  note
)
SELECT
  NULL,
  @answer_text,
  @question_id,
  @question_source,
  NULL
WHERE @answer_id IS NULL;

SET @answer_id = IF(@answer_id IS NULL, LAST_INSERT_ID(), @answer_id);

COMMIT;

SELECT
  @exam_id AS exam_id,
  @question_id AS question_id,
  @answer_id AS answer_id;

SELECT
  e.id AS exam_id,
  e.title AS exam_display_name,
  q.id AS question_id,
  q.question_number,
  q.score,
  q.source,
  a.id AS answer_id
FROM exams e
JOIN questions q ON q.exam_id = e.id
LEFT JOIN answers a ON a.question_id = q.id AND a.deleted_at IS NULL
WHERE e.id = @exam_id
  AND q.id = @question_id;
