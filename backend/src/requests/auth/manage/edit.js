import { authDB, errorDB } from '@database';

const main = async (request, response) => {
  const { email, role } = request.body;

  try {
    await authDB.updateUser({ email, role });
    await authDB.insertActionHistory({ user_id: request.user_id, action: 'edited_user', data: { email, role } });

    return response.status(200).json({
      code: 0,
      message: 'OK',
      data: null,
    });
  } catch (error) {
    await errorDB.writeError({
      name: 'auth/manage/edit',
      message: error?.message,
      status: error?.statusCode || 500,
      url: request?.originalUrl,
      details: {
        body: request?.body,
        params: request?.params,
        query: request?.query,
      },
    });
    return response.status(500).json({
      code: 1,
      message: 'Unknown error while editing user.',
    });
  }
};

export default main;
