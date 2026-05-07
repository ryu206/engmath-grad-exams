CREATE DATABASE IF NOT EXISTS engineering_math_bank
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE engineering_math_bank;

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE exams (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_kind VARCHAR(50) NOT NULL DEFAULT 'graduate_exam',
  title VARCHAR(255) NOT NULL,
  roc_year SMALLINT UNSIGNED NULL,
  university VARCHAR(100) NULL,
  department VARCHAR(100) NULL,
  division VARCHAR(100) NULL,
  subject VARCHAR(100) NULL,
  paper VARCHAR(50) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_exams_source_kind (source_kind),
  INDEX idx_exams_title (title),
  INDEX idx_exams_deleted_at (deleted_at),
  INDEX idx_exams_roc_year (roc_year),
  INDEX idx_exams_subject (subject),
  CONSTRAINT chk_exams_source_kind
    CHECK (source_kind IN ('graduate_exam', 'others')),
  CONSTRAINT chk_exams_title_not_blank
    CHECK (CHAR_LENGTH(TRIM(title)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE questions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  question_number VARCHAR(50) NULL,
  question_text LONGTEXT NULL,
  exam_id INT UNSIGNED NULL,
  score DECIMAL(6,2) NULL,
  question_type VARCHAR(50) NULL,
  difficulty VARCHAR(50) NULL,
  source VARCHAR(255) NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_questions_exam_id (exam_id),
  INDEX idx_questions_question_number (question_number),
  INDEX idx_questions_question_type (question_type),
  INDEX idx_questions_deleted_at (deleted_at),
  INDEX idx_questions_exam_list (exam_id, deleted_at, question_number),
  CONSTRAINT fk_questions_exam
    FOREIGN KEY (exam_id) REFERENCES exams (id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE choices (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  question_id INT UNSIGNED NOT NULL,
  A TEXT NULL,
  B TEXT NULL,
  C TEXT NULL,
  D TEXT NULL,
  E TEXT NULL,
  F TEXT NULL,
  G TEXT NULL,
  H TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_choices_question_id (question_id),
  INDEX idx_choices_deleted_at (deleted_at),
  CONSTRAINT fk_choices_question
    FOREIGN KEY (question_id) REFERENCES questions (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subquestions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  subquestion_number VARCHAR(50) NOT NULL,
  subquestion_text LONGTEXT NULL,
  main_question INT UNSIGNED NOT NULL,
  score DECIMAL(6,2) NULL,
  question_type VARCHAR(50) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_subquestions_main_question (main_question),
  INDEX idx_subquestions_number (subquestion_number),
  INDEX idx_subquestions_question_type (question_type),
  INDEX idx_subquestions_deleted_at (deleted_at),
  INDEX idx_subquestions_question_list (main_question, deleted_at, subquestion_number),
  CONSTRAINT fk_subquestions_main_question
    FOREIGN KEY (main_question) REFERENCES questions (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE subchoices (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  subquestion_id INT UNSIGNED NOT NULL,
  A TEXT NULL,
  B TEXT NULL,
  C TEXT NULL,
  D TEXT NULL,
  E TEXT NULL,
  F TEXT NULL,
  G TEXT NULL,
  H TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_subchoices_subquestion_id (subquestion_id),
  INDEX idx_subchoices_deleted_at (deleted_at),
  CONSTRAINT fk_subchoices_subquestion
    FOREIGN KEY (subquestion_id) REFERENCES subquestions (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE answers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  short_answer TEXT NULL,
  answer_text LONGTEXT NULL,
  question_id INT UNSIGNED NOT NULL,
  source VARCHAR(255) NULL,
  note TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  active_question_id INT UNSIGNED GENERATED ALWAYS AS (
    CASE WHEN deleted_at IS NULL THEN question_id ELSE NULL END
  ) STORED,
  PRIMARY KEY (id),
  INDEX idx_answers_question_id (question_id),
  INDEX idx_answers_deleted_at (deleted_at),
  UNIQUE KEY uq_answers_active_question (active_question_id),
  CONSTRAINT fk_answers_question
    FOREIGN KEY (question_id) REFERENCES questions (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attachments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_type VARCHAR(50) NOT NULL,
  owner_id INT UNSIGNED NOT NULL,
  usage_type VARCHAR(50) NOT NULL,
  disk VARCHAR(50) NOT NULL DEFAULT 'local',
  path VARCHAR(500) NOT NULL,
  url VARCHAR(1000) NULL,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  extension VARCHAR(20) NOT NULL,
  width INT UNSIGNED NULL,
  height INT UNSIGNED NULL,
  checksum VARCHAR(128) NULL,
  display_order SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  alt_text VARCHAR(255) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_attachments_owner (owner_type, owner_id),
  INDEX idx_attachments_usage (usage_type),
  INDEX idx_attachments_deleted_at (deleted_at),
  INDEX idx_attachments_checksum (checksum),
  CONSTRAINT chk_attachments_owner_type
    CHECK (owner_type IN ('question', 'subquestion', 'answer')),
  CONSTRAINT chk_attachments_usage_type
    CHECK (usage_type IN ('question_prompt', 'answer_explanation'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
