import { authDB, errorDB } from '@database';
import { enums } from '@json';
import { mailer, password as passwordLib, random, sanitizer } from '@libs';

const main = async (request, response) => {
  const { email, role = enums.USER_ROLES.USER } = request.body;
  const password = random.generateAlphanumeric(20);

  try {
    const hashed = await passwordLib.hashPassword(password);
    const isUserExist = await authDB.getUser(email);

    if (isUserExist) {
      return response.status(400).json({
        code: 400,
        message: 'User already exists',
      });
    }

    const token = random.generateAlphanumeric(32);
    await authDB.createUser({
      actorUserId: request.user_id,
      data: { password_reset_token: sanitizer.maskValue(token), email: sanitizer.maskValue(email) },
      email,
      password: hashed,
      role,
      token,
    });
    await mailer.sendWelcomeEmail({ email, token });

    return response.status(200).json({
      code: 0,
      message: 'OK',
      data: null,
    });
  } catch (error) {
    await errorDB.writeError({
      name: 'auth/manage/create',
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
      message: 'Unknown error while creating user.',
    });
  }
};

export default main;
