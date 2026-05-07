# Attachments Design Notes

## Current Decision

The project uses one shared `attachments` table with a polymorphic owner reference:

```text
attachments.owner_type
attachments.owner_id
attachments.usage_type
```

Current owner types:

```text
question     -> questions.id
subquestion  -> subquestions.id
answer       -> answers.id
```

Current usage types:

```text
question_prompt      question/subquestion prompt image
answer_explanation   answer explanation image
```

This is intentionally **not** modeled with direct foreign keys from `attachments.owner_id`, because one column can point to different tables depending on `owner_type`.

## Why We Chose This

This project currently has images as supporting data for questions, subquestions, and answers. A polymorphic attachment table keeps the schema small and lets new attachment owners be added without creating a new table for every owner type.

The tradeoff is that MySQL cannot enforce a true foreign key from `attachments.owner_id` to different tables. That relationship is enforced by application code and checked by maintenance queries.

## Guardrails

To reduce hidden coupling, legal values are centralized in:

```text
web/server/attachments/attachmentConstants.js
```

Database checks also restrict the allowed values:

```text
chk_attachments_owner_type
chk_attachments_usage_type
```

Migration:

```text
server/database/migrate_add_attachment_type_checks.sql
```

Orphan attachment report:

```text
server/database/report_orphan_attachments.sql
```

Run the orphan report when changing delete behavior, adding new attachment owners, or building image-management screens.

## Expansion Rules

When adding a new attachment owner type:

1. Add the owner type to `ATTACHMENT_OWNER_TYPES`.
2. Update the database CHECK constraint with a migration.
3. Update orphan-report SQL to join the new owner table.
4. Ensure delete/soft-delete flow also soft-deletes attachments.
5. Add image-management display logic for the new owner type.

When adding a new usage type:

1. Add the usage type to `ATTACHMENT_USAGE_TYPES`.
2. Update the database CHECK constraint with a migration.
3. Use the constant in reads/writes instead of string literals.

## When To Reconsider

Move from this polymorphic design to join tables if images become first-class reusable assets.

A future normalized design could be:

```text
attachments
question_attachments
subquestion_attachments
answer_attachments
```

That design is better if the system needs:

```text
one image reused by many questions
strict foreign keys for every owner relation
batch image relocation
image asset library workflows
auditable attachment history
```

Until those needs appear, keep the current design and maintain the guardrails above.
