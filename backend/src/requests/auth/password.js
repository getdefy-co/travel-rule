import { authDB, errorDB } from '@database';
import { password as passwordLib, sanitizer } from '@libs';

const main = async (request, response) => {
  const { token, password } = request.body;

  try {
    const resetPasswordToken = await authDB.getResetPasswordToken({ token });

    if (!resetPasswordToken) {
      return response.status(400).json({
        message: 'Invalid token.',
      });
    }

    if (new Date(resetPasswordToken.expires_at).getTime() < Date.now()) {
      return response.status(400).json({
        message: 'Token expired.',
      });
    }

    if (resetPasswordToken.used_at) {
      return response.status(400).json({
        message: 'Token already used.',
      });
    }

    const newHashed = await passwordLib.hashPassword(password);
    const result = await authDB.resetPassword({
      data: { password_reset_token: sanitizer.maskValue(token), new_password: sanitizer.maskValue(newHashed) },
      password: newHashed,
      token,
    });

    const resetErrors = {
      expired: 'Token expired.',
      invalid: 'Invalid token.',
      used: 'Token already used.',
    };

    if (result.status !== 'ok') {
      return response.status(400).json({ message: resetErrors[result.status] || 'Invalid token.' });
    }

    return response.status(200).json({
      code: 0,
      message: 'OK',
      data: null,
    });
  } catch (error) {
    await errorDB.writeError({
      name: 'auth/password',
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
      message: 'Unknown error while setting password.',
    });
  }
};

export default main;
