USE engineering_math_bank;

ALTER TABLE attachments
  ADD CONSTRAINT chk_attachments_owner_type
    CHECK (owner_type IN ('question', 'subquestion', 'answer')),
  ADD CONSTRAINT chk_attachments_usage_type
    CHECK (usage_type IN ('question_prompt', 'answer_explanation'));
