import { randomBytes } from 'node:crypto';
import { authDB, errorDB } from '@database';
import { jwt, password as passwordLib, sanitizer } from '@libs';

const authenticationFailed = response => {
  return response.status(401).json({ message: 'Authentication failed.' });
};

const SESSION_MAX_AGE_MILLISECONDS = 24 * 60 * 60 * 1000;
const cookieOptions = ({ httpOnly }) => {
  return {
    httpOnly,
    maxAge: SESSION_MAX_AGE_MILLISECONDS,
    path: '/',
    sameSite: 'strict',
    secure: true,
  };
};

const main = async (request, response) => {
  const { email, password } = request.body;

  try {
    const user = await authDB.getUser(email);

    if (!user) {
      return authenticationFailed(response);
    }

    const isMatch = await passwordLib.comparePassword(password, user.password);

    if (!isMatch) {
      return authenticationFailed(response);
    }

    if (!user.is_active) {
      return authenticationFailed(response);
    }

    const token = jwt.sign({ email: user.email, session_version: user.session_version });
    await authDB.insertActionHistory({ user_id: user.id, action: 'login', data: { token: sanitizer.maskValue(token) } });
    const csrfToken = randomBytes(32).toString('base64url');

    response.cookie('defy_session', token, cookieOptions({ httpOnly: true }));
    response.cookie('defy_csrf', csrfToken, cookieOptions({ httpOnly: false }));

    return response.status(200).json({
      code: 0,
      message: 'OK',
      data: token,
    });
  } catch (error) {
    await errorDB.writeError({
      name: 'auth/login',
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
      message: 'Unknown error while logging in.',
    });
  }
};

export default main;
