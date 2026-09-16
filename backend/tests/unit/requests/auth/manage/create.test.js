import { runRequestContract } from '../../requestTestUtils';
import { createRequest, createResponse } from '../../../../support/express';

runRequestContract('auth/manage/create.js', {
  boundary: {
    argumentCount: 1,
    firstArgument: 'engineer@example.com',
    label: 'database.authDB.getUser',
  },
  success: {
    code: 0,
    payloadKeys: ['code', 'data', 'message'],
    profile: 'auth-create-user-success',
    status: 200,
  },
});

const loadCreateUser = async ({ existingUser = null } = {}) => {
  jest.resetModules();
  const authDB = {
    createUser: jest.fn(),
    getUser: jest.fn().mockResolvedValueOnce(existingUser),
    insertActionHistory: jest.fn(),
  };
  const errorDB = { writeError: jest.fn() };
  const mailer = { sendWelcomeEmail: jest.fn() };
  const password = { hashPassword: jest.fn().mockResolvedValue('hashed-password') };
  const random = { generateAlphanumeric: jest.fn().mockReturnValueOnce('temporary-password').mockReturnValueOnce('reset-token') };
  const sanitizer = { maskValue: jest.fn(() => '[REDACTED]') };
  jest.doMock('@database', () => ({ authDB, errorDB }));
  jest.doMock('@json', () => ({ enums: { USER_ROLES: { ADMIN: 'admin', USER: 'user' } } }));
  jest.doMock('@libs', () => ({ mailer, password, random, sanitizer }));
  const { default: handler } = await import('../../../../../src/requests/auth/manage/create');
  return { authDB, handler, mailer };
};

test('creates an admin without persisting API-key input and sends a one-time reset token', async () => {
  const loaded = await loadCreateUser();
  const response = createResponse();
  await loaded.handler(createRequest({ body: { apikey: 'ignored-key', email: 'new@example.test', role: 'admin' }, user_id: 7 }), response);

  expect(loaded.authDB.createUser).toHaveBeenCalledWith({
    actorUserId: 7,
    data: { email: '[REDACTED]', password_reset_token: '[REDACTED]' },
    email: 'new@example.test',
    password: 'hashed-password',
    role: 'admin',
    token: 'reset-token',
  });
  expect(loaded.mailer.sendWelcomeEmail).toHaveBeenCalledWith({ email: 'new@example.test', token: 'reset-token' });
  expect(loaded.authDB.insertActionHistory).not.toHaveBeenCalled();
});

test('does not create a duplicate user', async () => {
  const loaded = await loadCreateUser({ existingUser: { id: 2 } });
  const response = createResponse();
  await loaded.handler(createRequest({ body: { email: 'new@example.test', role: 'user' } }), response);
  expect(response.status).toHaveBeenCalledWith(400);
  expect(response.json).toHaveBeenCalledWith({ code: 400, message: 'User already exists' });
  expect(loaded.authDB.createUser).not.toHaveBeenCalled();
});
