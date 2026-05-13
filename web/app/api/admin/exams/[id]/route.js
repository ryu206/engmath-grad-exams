import { getConnection } from '@/lib/db';
import { buildExamTitle, emptyToNull, normalizeSourceKind } from '@/lib/exams';

export const runtime = 'nodejs';

const DB_OPERATION_TIMEOUT_MS = 55000;
const MAX_SOURCE_LENGTH = 2048;

function numberOrNull(value) {
  const normalized = emptyToNull(value);
  if (normalized === null) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function examIdFromParams(params) {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateExam(exam) {
  const errors = {};
  const sourceKind = normalizeSourceKind(exam.source_kind);
  const rocYear = numberOrNull(exam.roc_year);
  const university = emptyToNull(exam.university);
  const titleInput = emptyToNull(exam.title);
  const source = emptyToNull(exam.source);
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

  if (source !== null && source.length > MAX_SOURCE_LENGTH) {
    errors.source = `Source cannot exceed ${MAX_SOURCE_LENGTH} characters`;
  }

  const data = {
    source_kind: sourceKind || 'graduate_exam',
    title: null,
    source,
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

async function withTimedConnection(callback) {
  const connection = await getConnection();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    connection.destroy();
  }, DB_OPERATION_TIMEOUT_MS);

  try {
    return await callback(connection);
  } catch (error) {
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

export async function GET(_request, { params }) {
  const id = examIdFromParams(await params);
  if (!id) {
    return Response.json({ success: false, message: 'Invalid exam id' }, { status: 400 });
  }

  try {
    return await withTimedConnection(async (connection) => {
      const [rows] = await connection.execute(
        `SELECT
          id,
          source_kind,
          title,
          source,
          roc_year,
          university,
          department,
          division,
          subject,
          paper
        FROM exams
        WHERE id = ?
          AND deleted_at IS NULL
        LIMIT 1`,
        [id],
      );

      if (rows.length === 0) {
        return Response.json({ success: false, message: 'Exam not found' }, { status: 404 });
      }

      return Response.json(
        { success: true, data: rows[0] },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    });
  } catch (error) {
    if (error.message === 'REQUEST_TIMEOUT') {
      return Response.json({ success: false, message: 'Request timeout. Please try again later.' }, { status: 504 });
    }

    console.error('Failed to fetch exam:', error);
    return Response.json({ success: false, message: 'Failed to fetch exam' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  const id = examIdFromParams(await params);
  if (!id) {
    return Response.json({ success: false, message: 'Invalid exam id' }, { status: 400 });
  }

  try {
    const payload = await request.json();
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

    return await withTimedConnection(async (connection) => {
      await connection.beginTransaction();

      try {
        const [result] = await connection.execute(
          `UPDATE exams
          SET
            source_kind = ?,
            title = ?,
            source = ?,
            roc_year = ?,
            university = ?,
            department = ?,
            division = ?,
            subject = ?,
            paper = ?
          WHERE id = ?
            AND deleted_at IS NULL`,
          [
            validation.data.source_kind,
            validation.data.title,
            validation.data.source,
            validation.data.roc_year,
            validation.data.university,
            validation.data.department,
            validation.data.division,
            validation.data.subject,
            validation.data.paper,
            id,
          ],
        );

        if (result.affectedRows === 0) {
          await connection.rollback();
          return Response.json({ success: false, message: 'Exam not found' }, { status: 404 });
        }

        await connection.commit();

        return Response.json({
          success: true,
          message: 'Exam updated',
          data: {
            id,
            source_kind: validation.data.source_kind,
            title: validation.data.title,
            source: validation.data.source,
            redirect_to: `/prototype/edit-exams.html?id=${id}`,
          },
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  } catch (error) {
    if (error.message === 'REQUEST_TIMEOUT') {
      return Response.json({ success: false, message: 'Request timeout. Please try again later.' }, { status: 504 });
    }

    if (error instanceof SyntaxError) {
      return Response.json({ success: false, message: 'Invalid JSON payload' }, { status: 400 });
    }

    console.error('Failed to update exam:', error);
    return Response.json({ success: false, message: 'Failed to update exam' }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  const id = examIdFromParams(await params);
  if (!id) {
    return Response.json({ success: false, message: 'Invalid exam id' }, { status: 400 });
  }

  try {
    return await withTimedConnection(async (connection) => {
      await connection.beginTransaction();

      try {
        const [result] = await connection.execute(
          `UPDATE exams
          SET deleted_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND deleted_at IS NULL`,
          [id],
        );

        if (result.affectedRows === 0) {
          await connection.rollback();
          return Response.json({ success: false, message: 'Exam not found' }, { status: 404 });
        }

        await connection.commit();

        return Response.json({
          success: true,
          message: 'Exam deleted',
          data: {
            id,
            redirect_to: '/prototype/exams-list.html',
          },
        });
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    });
  } catch (error) {
    if (error.message === 'REQUEST_TIMEOUT') {
      return Response.json({ success: false, message: 'Request timeout. Please try again later.' }, { status: 504 });
    }

    console.error('Failed to delete exam:', error);
    return Response.json({ success: false, message: 'Failed to delete exam' }, { status: 500 });
  }
}
