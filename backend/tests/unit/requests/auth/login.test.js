import { runRequestContract } from '../requestTestUtils';
import { createRequest, createResponse } from '../../../support/express';

runRequestContract('auth/login.js', {
  boundary: {
    argumentCount: 1,
    firstArgument: 'engineer@example.com',
    label: 'database.authDB.getUser',
  },
  success: {
    code: 0,
    payloadKeys: ['code', 'data', 'message'],
    status: 200,
  },
});

const loadLogin = async ({ passwordMatches = true, user = { email: 'user@example.test', id: 7, is_active: true, password: 'hash', session_version: 4 } } = {}) => {
  jest.resetModules();
  const authDB = { getUser: jest.fn().mockResolvedValue(user), insertActionHistory: jest.fn() };
  const errorDB = { writeError: jest.fn() };
  const jwt = { sign: jest.fn().mockReturnValue('signed-token') };
  const password = { comparePassword: jest.fn().mockResolvedValue(passwordMatches) };
  const sanitizer = { maskValue: jest.fn().mockReturnValue('[REDACTED]') };
  jest.doMock('@database', () => ({ authDB, errorDB }));
  jest.doMock('@libs', () => ({ jwt, password, sanitizer }));
  const { default: handler } = await import('../../../../src/requests/auth/login');
  return { authDB, handler, jwt };
};

test.each([
  ['unknown email', { user: null }],
  ['wrong password', { passwordMatches: false }],
  ['inactive user', { user: { email: 'user@example.test', id: 7, is_active: false, password: 'hash', session_version: 4 } }],
])('returns the same generic 401 for %s', async (_label, options) => {
  const loaded = await loadLogin(options);
  const response = createResponse();
  await loaded.handler(createRequest({ body: { email: 'user@example.test', password: 'password-1' }, originalUrl: '/auth/login' }), response);

  expect(response.status).toHaveBeenCalledWith(401);
  expect(response.json).toHaveBeenCalledWith({ message: 'Authentication failed.' });
});

test('binds a successful JWT to the current session version', async () => {
  const loaded = await loadLogin();
  const response = createResponse();
  await loaded.handler(createRequest({ body: { email: 'user@example.test', password: 'password-1' }, originalUrl: '/auth/login' }), response);

  expect(loaded.jwt.sign).toHaveBeenCalledWith({ email: 'user@example.test', session_version: 4 });
});

test('issues the browser session and CSRF cookies without weakening the existing JWT response', async () => {
  const loaded = await loadLogin();
  const response = createResponse();
  await loaded.handler(createRequest({ body: { email: 'user@example.test', password: 'password-1' }, originalUrl: '/auth/login' }), response);

  expect(response.cookie).toHaveBeenCalledWith('defy_session', 'signed-token', expect.objectContaining({ httpOnly: true, maxAge: 86400000, sameSite: 'strict', secure: true }));
  expect(response.cookie).toHaveBeenCalledWith(
    'defy_csrf',
    expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    expect.objectContaining({ httpOnly: false, maxAge: 86400000, sameSite: 'strict', secure: true }),
  );
  expect(response.json).toHaveBeenCalledWith({ code: 0, data: 'signed-token', message: 'OK' });
});
