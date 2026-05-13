export const ATTACHMENT_OWNER_TYPES = Object.freeze({
  QUESTION: 'question',
  ANSWER: 'answer',
});

export const ATTACHMENT_USAGE_TYPES = Object.freeze({
  QUESTION_PROMPT: 'question_prompt',
  ANSWER_EXPLANATION: 'answer_explanation',
});

export const VALID_ATTACHMENT_OWNER_TYPES = new Set(Object.values(ATTACHMENT_OWNER_TYPES));
export const VALID_ATTACHMENT_USAGE_TYPES = new Set(Object.values(ATTACHMENT_USAGE_TYPES));

export function assertAttachmentOwnerType(ownerType) {
  if (!VALID_ATTACHMENT_OWNER_TYPES.has(ownerType)) {
    throw new Error(`Invalid attachment owner_type: ${ownerType}`);
  }
}

export function assertAttachmentUsageType(usageType) {
  if (!VALID_ATTACHMENT_USAGE_TYPES.has(usageType)) {
    throw new Error(`Invalid attachment usage_type: ${usageType}`);
  }
}
