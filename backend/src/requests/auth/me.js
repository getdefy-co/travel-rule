import { authDB, errorDB } from '@database';

const main = async (request, response) => {
  const { email } = request;

  try {
    const data = await authDB.getUser(email, { filter: true });

    return response.status(200).json({
      code: 0,
      message: 'OK',
      data,
    });
  } catch (error) {
    await errorDB.writeError({
      name: 'auth/me',
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
      message: 'Unknown error while fetching user data.',
    });
  }
};

export default main;
