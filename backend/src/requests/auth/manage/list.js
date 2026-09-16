import { authDB, errorDB } from '@database';

const main = async (request, response) => {
  const { page, limit, search } = request.query;

  try {
    const { data, total } = await authDB.listUsers({ page, limit, search });
    const users = data.map(user => {
      return { active: user.active, created_at: user.created_at, email: user.email, role: user.role };
    });

    return response.status(200).json({
      code: 0,
      message: 'OK',
      data: users,
      page_count: Math.ceil(parseInt(total, 10) / limit),
    });
  } catch (error) {
    await errorDB.writeError({
      name: 'auth/manage/list',
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
      message: 'Unknown error while listing users.',
    });
  }
};

export default main;
