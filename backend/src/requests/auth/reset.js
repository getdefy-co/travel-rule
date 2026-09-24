import { authDB, errorDB } from '@database';
import { password as passwordLib, sanitizer } from '@libs';

const main = async (request, response) => {
  const { old_password, new_password } = request.body;
  const { email } = request;

  try {
    const user = await authDB.getUser(email);
    const isMatch = await passwordLib.comparePassword(old_password, user.password);

    if (!isMatch) {
      return response.status(400).json({ message: 'Old password is not valid.' });
    }

    const newHashed = await passwordLib.hashPassword(new_password);
    await authDB.changePassword({
      data: { old_password: sanitizer.maskValue(old_password), new_password: sanitizer.maskValue(newHashed) },
      email,
      password: newHashed,
      userId: user.id,
    });

    return response.status(200).json({
      code: 0,
      message: 'OK',
      data: null,
    });
  } catch (error) {
    await errorDB.writeError({
      name: 'auth/reset',
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
      message: 'Unknown error while resetting password.',
    });
  }
};

export default main;
