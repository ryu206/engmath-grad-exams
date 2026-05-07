USE engineering_math_bank;

ALTER TABLE exams
  ADD COLUMN source_kind VARCHAR(50) NOT NULL DEFAULT 'graduate_exam' AFTER id,
  ADD COLUMN title VARCHAR(255) NULL AFTER source_kind,
  ADD INDEX idx_exams_source_kind (source_kind),
  ADD INDEX idx_exams_title (title);

UPDATE exams
SET
  source_kind = 'graduate_exam',
  title = NULLIF(CONCAT_WS('', roc_year, university, department, division, subject, paper), '')
WHERE title IS NULL;

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
