import { authDB, errorDB } from '@database';
import { mailer, random, sanitizer } from '@libs';

const main = async (request, response) => {
  const { email } = request.body;

  try {
    const user = await authDB.getUser(email);

    if (!user) {
      return response.status(200).json({
        code: 0,
        message: 'If the email is registered, you will receive password reset instructions.',
        data: null,
      });
    }

    const token = random.generateAlphanumeric(32);
    await authDB.createResetPasswordToken({ userId: user.id, token });
    await mailer.sendForgotPasswordEmail({ email, token });
    await authDB.insertActionHistory({ user_id: user.id, action: 'forgot_password', data: { password_reset_token: sanitizer.maskValue(token), email: sanitizer.maskValue(email) } });

    return response.status(200).json({
      code: 0,
      message: 'If the email is registered, you will receive password reset instructions.',
      data: null,
    });
  } catch (error) {
    await errorDB.writeError({
      name: 'auth/forgot',
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
      message: 'Unknown error while processing forgot password.',
    });
  }
};

export default main;
