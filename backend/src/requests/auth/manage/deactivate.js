import { authDB, errorDB } from '@database';

const main = async (request, response) => {
  const { email } = request.body;

  try {
    await authDB.deactivateUser({ email });
    await authDB.insertActionHistory({ user_id: request.user_id, action: 'deactivated_user', data: { email } });

    return response.status(200).json({
      code: 0,
      message: 'OK',
      data: null,
    });
  } catch (error) {
    await errorDB.writeError({
      name: 'auth/manage/deactivate',
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
      message: 'Unknown error while deactivating user.',
    });
  }
};

export default main;
