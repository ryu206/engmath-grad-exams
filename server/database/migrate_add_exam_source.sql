USE engineering_math_bank;

ALTER TABLE exams
  ADD COLUMN source VARCHAR(2048) NULL AFTER title;
