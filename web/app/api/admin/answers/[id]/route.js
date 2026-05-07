import { deleteAnswer, getAnswerById, updateAnswerFromFormData } from '@/server/services/answerService';

export const runtime = 'nodejs';

function idFromParams(params) {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request, { params }) {
  try {
    const result = await getAnswerById(idFromParams(await params));
    return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to fetch answer:', error);
    return Response.json({ success: false, message: 'Failed to fetch answer' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const formData = await request.formData();
    const result = await updateAnswerFromFormData(idFromParams(await params), formData);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Failed to update answer:', error);
    return Response.json({ success: false, message: 'Failed to update answer' }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const result = await deleteAnswer(idFromParams(await params));
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Failed to delete answer:', error);
    return Response.json({ success: false, message: 'Failed to delete answer' }, { status: 500 });
  }
}
