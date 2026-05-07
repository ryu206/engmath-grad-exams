import { getAnswerByQuestionId } from '@/server/services/answerService';

export const runtime = 'nodejs';

function idFromParams(params) {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request, { params }) {
  try {
    const result = await getAnswerByQuestionId(idFromParams(await params));
    return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to fetch question answer:', error);
    return Response.json({ success: false, message: 'Failed to fetch question answer' }, { status: 500 });
  }
}
