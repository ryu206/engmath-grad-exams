import { createAnswerFromFormData } from '@/server/services/answerService';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const formData = await request.formData();
    const result = await createAnswerFromFormData(formData);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Failed to create answer:', error);
    return Response.json({ success: false, message: 'Failed to create answer' }, { status: 500 });
  }
}
