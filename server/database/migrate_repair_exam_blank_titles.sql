USE engineering_math_bank;

UPDATE exams
SET title = NULLIF(CONCAT_WS('', roc_year, university, department, division, subject, paper), '')
WHERE source_kind = 'graduate_exam'
  AND (title IS NULL OR TRIM(title) = '');

UPDATE exams
SET title = CONCAT('考試 #', id)
WHERE title IS NULL OR TRIM(title) = '';

ALTER TABLE exams
  MODIFY title VARCHAR(255) NOT NULL;

ALTER TABLE exams
  ADD CONSTRAINT chk_exams_source_kind
    CHECK (source_kind IN ('graduate_exam', 'others')),
  ADD CONSTRAINT chk_exams_title_not_blank
    CHECK (CHAR_LENGTH(TRIM(title)) > 0);
