import { getConnection } from '@/lib/db';
import { ATTACHMENT_OWNER_TYPES, ATTACHMENT_USAGE_TYPES } from '@/server/attachments/attachmentConstants';
import { findActiveAttachments, insertAttachment, softDeleteAttachments } from '@/server/repositories/attachmentRepository';
import {
  findActiveAnswerById,
  findActiveAnswerByQuestionId,
  insertAnswer,
  softDeleteAnswer,
  updateAnswer,
} from '@/server/repositories/answerRepository';
import { findActiveQuestionById } from '@/server/repositories/questionRepository';
import { deleteStoredFiles, storeLocalImage, validateImageFile } from '@/server/storage/localImageStorage';

const DB_OPERATION_TIMEOUT_MS = 115000;

function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseAnswerPayload(formData) {
  const payload = JSON.parse(String(formData.get('payload') || '{}'));
  const answer = payload.answers || payload.answer || {};
  const image = formData.get('answer_image');

  return {
    answer,
    image: image instanceof File && image.size > 0 ? image : null,
  };
}

function validateCreateAnswer(answer, image) {
  const errors = [];

  if (!positiveInteger(answer.question_id)) errors.push('question_id is required');
  if (!emptyToNull(answer.answer_text)) errors.push('answer_text is required');

  const imageError = validateImageFile(image, 'answer image');
  if (imageError) errors.push(imageError);

  return errors;
}

function validateUpdateAnswer(answer, image) {
  const errors = [];

  if (!emptyToNull(answer.answer_text)) errors.push('answer_text is required');

  const imageError = validateImageFile(image, 'answer image');
  if (imageError) errors.push(imageError);

  return errors;
}

async function runWithTimedConnection(callback) {
  const connection = await getConnection();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    connection.destroy();
  }, DB_OPERATION_TIMEOUT_MS);

  try {
    return await callback(connection);
  } catch (error) {
    if (timedOut) throw new Error('REQUEST_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (!timedOut) connection.release();
  }
}

export async function createAnswerFromFormData(formData) {
  const uploadedPaths = [];
  const { answer, image } = parseAnswerPayload(formData);
  const validationErrors = validateCreateAnswer(answer, image);

  if (validationErrors.length > 0) {
    return {
      ok: false,
      status: 422,
      body: { success: false, message: 'Validation failed', errors: validationErrors },
    };
  }

  try {
    const data = await runWithTimedConnection(async (connection) => {
      await connection.beginTransaction();

      try {
        const questionId = positiveInteger(answer.question_id);
        const question = await findActiveQuestionById(connection, questionId);
        if (!question) {
          await connection.rollback().catch(() => {});
          return {
            ok: false,
            status: 404,
            body: { success: false, message: 'Question not found' },
          };
        }

        const existingAnswer = await findActiveAnswerByQuestionId(connection, questionId);
        if (existingAnswer) {
          await connection.rollback().catch(() => {});
          return {
            ok: false,
            status: 409,
            body: { success: false, message: 'This question already has an active answer' },
          };
        }

        const answerId = await insertAnswer(connection, answer);

        if (image) {
          const stored = await storeLocalImage(image, ATTACHMENT_OWNER_TYPES.ANSWER, answerId);
          uploadedPaths.push(stored.absolutePath);
          await insertAttachment(connection, {
            owner_type: ATTACHMENT_OWNER_TYPES.ANSWER,
            owner_id: answerId,
            usage_type: ATTACHMENT_USAGE_TYPES.ANSWER_EXPLANATION,
            ...stored.attachment,
          });
        }

        await connection.commit();
        return {
          ok: true,
          status: 201,
          body: {
            success: true,
            message: 'Answer created',
            data: {
              id: answerId,
              question_id: questionId,
              redirect_to: `/prototype/edit-answer.html?question_id=${questionId}`,
            },
          },
        };
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      }
    });

    return data;
  } catch (error) {
    await deleteStoredFiles(uploadedPaths);
    if (error.message === 'REQUEST_TIMEOUT') {
      return {
        ok: false,
        status: 504,
        body: { success: false, message: 'Request timeout. Please check database status and try again.' },
      };
    }
    throw error;
  }
}

function answerView(answer, question, attachments) {
  return {
    answer: {
      ...answer,
      attachments,
      image: attachments[0] || null,
    },
    question,
  };
}

export async function getAnswerByQuestionId(questionId) {
  const normalizedQuestionId = positiveInteger(questionId);
  if (!normalizedQuestionId) {
    return { ok: false, status: 400, body: { success: false, message: 'Invalid question id' } };
  }

  try {
    const data = await runWithTimedConnection(async (connection) => {
      const question = await findActiveQuestionById(connection, normalizedQuestionId);
      if (!question) return { ok: false, status: 404, body: { success: false, message: 'Question not found' } };

      const answer = await findActiveAnswerByQuestionId(connection, normalizedQuestionId);
      if (!answer) return { ok: false, status: 404, body: { success: false, message: 'Answer not found' } };

      const attachments = await findActiveAttachments(
        connection,
        ATTACHMENT_OWNER_TYPES.ANSWER,
        answer.id,
        ATTACHMENT_USAGE_TYPES.ANSWER_EXPLANATION,
      );
      return { ok: true, status: 200, body: { success: true, data: answerView(answer, question, attachments) } };
    });

    return data;
  } catch (error) {
    if (error.message === 'REQUEST_TIMEOUT') {
      return { ok: false, status: 504, body: { success: false, message: 'Request timeout. Please try again later.' } };
    }
    throw error;
  }
}

export async function getAnswerById(answerId) {
  const normalizedAnswerId = positiveInteger(answerId);
  if (!normalizedAnswerId) {
    return { ok: false, status: 400, body: { success: false, message: 'Invalid answer id' } };
  }

  try {
    const data = await runWithTimedConnection(async (connection) => {
      const answer = await findActiveAnswerById(connection, normalizedAnswerId);
      if (!answer) return { ok: false, status: 404, body: { success: false, message: 'Answer not found' } };

      const question = await findActiveQuestionById(connection, answer.question_id);
      const attachments = await findActiveAttachments(
        connection,
        ATTACHMENT_OWNER_TYPES.ANSWER,
        answer.id,
        ATTACHMENT_USAGE_TYPES.ANSWER_EXPLANATION,
      );
      return { ok: true, status: 200, body: { success: true, data: answerView(answer, question, attachments) } };
    });

    return data;
  } catch (error) {
    if (error.message === 'REQUEST_TIMEOUT') {
      return { ok: false, status: 504, body: { success: false, message: 'Request timeout. Please try again later.' } };
    }
    throw error;
  }
}

export async function updateAnswerFromFormData(answerId, formData) {
  const normalizedAnswerId = positiveInteger(answerId);
  const uploadedPaths = [];
  if (!normalizedAnswerId) {
    return { ok: false, status: 400, body: { success: false, message: 'Invalid answer id' } };
  }

  const { answer, image } = parseAnswerPayload(formData);
  const validationErrors = validateUpdateAnswer(answer, image);
  if (validationErrors.length > 0) {
    return {
      ok: false,
      status: 422,
      body: { success: false, message: 'Validation failed', errors: validationErrors },
    };
  }

  try {
    const data = await runWithTimedConnection(async (connection) => {
      await connection.beginTransaction();

      try {
        const currentAnswer = await findActiveAnswerById(connection, normalizedAnswerId);
        if (!currentAnswer) {
          await connection.rollback().catch(() => {});
          return { ok: false, status: 404, body: { success: false, message: 'Answer not found' } };
        }

        await updateAnswer(connection, normalizedAnswerId, answer);

        if (answer.delete_answer_image || image) {
          await softDeleteAttachments(
            connection,
            ATTACHMENT_OWNER_TYPES.ANSWER,
            normalizedAnswerId,
            ATTACHMENT_USAGE_TYPES.ANSWER_EXPLANATION,
          );
        }

        if (image) {
          const stored = await storeLocalImage(image, ATTACHMENT_OWNER_TYPES.ANSWER, normalizedAnswerId);
          uploadedPaths.push(stored.absolutePath);
          await insertAttachment(connection, {
            owner_type: ATTACHMENT_OWNER_TYPES.ANSWER,
            owner_id: normalizedAnswerId,
            usage_type: ATTACHMENT_USAGE_TYPES.ANSWER_EXPLANATION,
            ...stored.attachment,
          });
        }

        await connection.commit();
        return {
          ok: true,
          status: 200,
          body: {
            success: true,
            message: 'Answer updated',
            data: { id: normalizedAnswerId, question_id: currentAnswer.question_id },
          },
        };
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      }
    });

    return data;
  } catch (error) {
    await deleteStoredFiles(uploadedPaths);
    if (error.message === 'REQUEST_TIMEOUT') {
      return { ok: false, status: 504, body: { success: false, message: 'Request timeout. Please check database status and try again.' } };
    }
    throw error;
  }
}

export async function deleteAnswer(answerId) {
  const normalizedAnswerId = positiveInteger(answerId);
  if (!normalizedAnswerId) {
    return { ok: false, status: 400, body: { success: false, message: 'Invalid answer id' } };
  }

  try {
    const data = await runWithTimedConnection(async (connection) => {
      await connection.beginTransaction();

      try {
        const answer = await findActiveAnswerById(connection, normalizedAnswerId);
        if (!answer) {
          await connection.rollback().catch(() => {});
          return { ok: false, status: 404, body: { success: false, message: 'Answer not found' } };
        }

        await softDeleteAttachments(
          connection,
          ATTACHMENT_OWNER_TYPES.ANSWER,
          normalizedAnswerId,
          ATTACHMENT_USAGE_TYPES.ANSWER_EXPLANATION,
        );
        await softDeleteAnswer(connection, normalizedAnswerId);
        await connection.commit();
        return {
          ok: true,
          status: 200,
          body: { success: true, message: 'Answer deleted', data: { id: normalizedAnswerId, question_id: answer.question_id } },
        };
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      }
    });

    return data;
  } catch (error) {
    if (error.message === 'REQUEST_TIMEOUT') {
      return { ok: false, status: 504, body: { success: false, message: 'Request timeout. Please check database status and try again.' } };
    }
    throw error;
  }
}
