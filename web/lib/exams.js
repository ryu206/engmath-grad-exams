export const EXAM_SOURCE_KINDS = new Set(['graduate_exam', 'others']);

export function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

export function normalizeSourceKind(value) {
  const sourceKind = emptyToNull(value) || 'graduate_exam';
  return EXAM_SOURCE_KINDS.has(sourceKind) ? sourceKind : null;
}

export function buildGraduateExamTitle(exam) {
  return [
    exam.roc_year,
    exam.university,
    exam.department,
    exam.division,
    exam.subject,
    exam.paper,
  ].filter((part) => part !== null && part !== undefined && String(part).trim() !== '').join('');
}

export function buildExamTitle(exam) {
  const sourceKind = normalizeSourceKind(exam.source_kind);
  if (sourceKind === 'graduate_exam') {
    return buildGraduateExamTitle(exam);
  }
  return emptyToNull(exam.title) || '';
}
