import logout from '../../../../src/requests/auth/logout';
import { createRequest, createResponse } from '../../../support/express';

test('clears both browser authentication cookies with their original security attributes', () => {
  const response = createResponse();

  logout(createRequest(), response);

  expect(response.clearCookie).toHaveBeenCalledWith('defy_session', { httpOnly: true, path: '/', sameSite: 'strict', secure: true });
  expect(response.clearCookie).toHaveBeenCalledWith('defy_csrf', { httpOnly: false, path: '/', sameSite: 'strict', secure: true });
  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json).toHaveBeenCalledWith({ code: 0, data: null, message: 'OK' });
});
