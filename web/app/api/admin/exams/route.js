import { getConnection } from '@/lib/db';
import { buildExamTitle, emptyToNull, normalizeSourceKind } from '@/lib/exams';

export const runtime = 'nodejs';

const DB_OPERATION_TIMEOUT_MS = 55000;

function numberOrNull(value) {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function validateExam(exam) {
  const errors = {};
  const sourceKind = normalizeSourceKind(exam.source_kind);
  const rocYear = numberOrNull(exam.roc_year);
  const university = emptyToNull(exam.university);
  const titleInput = emptyToNull(exam.title);
  const paper = emptyToNull(exam.paper);

  if (!sourceKind) {
    errors.source_kind = 'Invalid source kind';
  }

  if (rocYear !== null && (!Number.isInteger(rocYear) || rocYear < 1 || rocYear > 9999)) {
    errors.roc_year = 'ROC year must be an integer from 1 to 9999';
  }

  if (university !== null && university.length > 100) {
    errors.university = 'University cannot exceed 100 characters';
  }

  for (const field of ['department', 'division', 'subject']) {
    const value = emptyToNull(exam[field]);
    if (value !== null && value.length > 100) {
      errors[field] = 'Field cannot exceed 100 characters';
    }
  }

  if (paper !== null && paper.length > 50) {
    errors.paper = 'Paper cannot exceed 50 characters';
  }

  const data = {
    source_kind: sourceKind || 'graduate_exam',
    title: null,
    roc_year: sourceKind === 'graduate_exam' ? rocYear : null,
    university: sourceKind === 'graduate_exam' ? university : null,
    department: sourceKind === 'graduate_exam' ? emptyToNull(exam.department) : null,
    division: sourceKind === 'graduate_exam' ? emptyToNull(exam.division) : null,
    subject: sourceKind === 'graduate_exam' ? emptyToNull(exam.subject) : null,
    paper: sourceKind === 'graduate_exam' ? paper : null,
  };

  data.title = sourceKind === 'graduate_exam' ? buildExamTitle(data) : titleInput;

  if (!data.title) {
    errors.title = sourceKind === 'others' ? 'Title is required' : 'Graduate exam title is empty';
  } else if (data.title.length > 255) {
    errors.title = 'Title cannot exceed 255 characters';
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    data,
  };
}

async function createExam(payload) {
  const validation = validateExam(payload.exams || {});

  if (!validation.ok) {
    return Response.json(
      {
        success: false,
        message: 'Validation failed',
        errors: validation.errors,
      },
      { status: 422 },
    );
  }

  const connection = await getConnection();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    connection.destroy();
  }, DB_OPERATION_TIMEOUT_MS);

  try {
    await connection.beginTransaction();

    const [result] = await connection.execute(
      `INSERT INTO exams (
        source_kind,
        title,
        roc_year,
        university,
        department,
        division,
        subject,
        paper
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        validation.data.source_kind,
        validation.data.title,
        validation.data.roc_year,
        validation.data.university,
        validation.data.department,
        validation.data.division,
        validation.data.subject,
        validation.data.paper,
      ],
    );

    await connection.commit();

    return Response.json(
      {
        success: true,
        message: 'Exam created',
        data: {
          id: result.insertId,
          source_kind: validation.data.source_kind,
          title: validation.data.title,
          redirect_to: '/prototype/exams-list.html',
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (!timedOut) {
      await connection.rollback();
    }
    if (timedOut) {
      throw new Error('REQUEST_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (!timedOut) {
      connection.release();
    }
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    return await createExam(payload);
  } catch (error) {
    if (error.message === 'REQUEST_TIMEOUT') {
      return Response.json(
        {
          success: false,
          message: 'Request timeout. Please try again later.',
        },
        { status: 504 },
      );
    }

    if (error instanceof SyntaxError) {
      return Response.json(
        {
          success: false,
          message: 'Invalid JSON payload',
        },
        { status: 400 },
      );
    }

    console.error('Failed to create exam:', error);

    return Response.json(
      {
        success: false,
        message: 'Failed to create exam',
      },
      { status: 500 },
    );
  }
}
