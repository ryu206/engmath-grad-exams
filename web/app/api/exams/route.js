import { getConnection } from '@/lib/db';

export const runtime = 'nodejs';

const MAX_PER_PAGE = 100;
const DB_OPERATION_TIMEOUT_MS = 55000;

function clampPage(value) {
  const page = Number(value || 1);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function clampPerPage(value) {
  const perPage = Number(value || 20);
  if (!Number.isInteger(perPage) || perPage < 1) return 20;
  return Math.min(perPage, MAX_PER_PAGE);
}

function orderByFor(sort) {
  if (sort === 'roc_asc') return 'roc_year ASC, id ASC';
  if (sort === 'name_asc') {
    return 'title ASC, id ASC';
  }
  return 'roc_year DESC, id DESC';
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = clampPage(searchParams.get('page'));
  const perPage = clampPerPage(searchParams.get('per_page'));
  const sort = searchParams.get('sort') || 'roc_desc';
  const keyword = (searchParams.get('q') || '').trim();
  const offset = (page - 1) * perPage;

  const where = ['deleted_at IS NULL'];
  const params = [];

  if (keyword !== '') {
    where.push(`title LIKE ?`);
    params.push(`%${keyword}%`);
  }

  const whereSql = where.join(' AND ');
  const orderBy = orderByFor(sort);
  const connection = await getConnection();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    connection.destroy();
  }, DB_OPERATION_TIMEOUT_MS);

  try {
    const [countRows] = await connection.execute(
      `SELECT COUNT(*) AS total FROM exams WHERE ${whereSql}`,
      params,
    );

    const total = Number(countRows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / perPage));

    const [rows] = await connection.execute(
      `SELECT
        id,
        source_kind,
        title,
        roc_year,
        university,
        department,
        division,
        subject,
        paper
      FROM exams
      WHERE ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?`,
      [...params, perPage, offset],
    );

    return Response.json({
      success: true,
      data: rows,
      meta: {
        page,
        per_page: perPage,
        total,
        total_pages: totalPages,
      },
    });
  } catch (error) {
    if (timedOut) {
      return Response.json(
        {
          success: false,
          message: 'Request timeout. Please try again later.',
        },
        { status: 504 },
      );
    }

    console.error('Failed to fetch exams:', error);
    return Response.json(
      {
        success: false,
        message: 'Failed to fetch exams',
      },
      { status: 500 },
    );
  } finally {
    clearTimeout(timeoutId);
    if (!timedOut) {
      connection.release();
    }
  }
}
