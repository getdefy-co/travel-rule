import { runRequestContract } from '../requestTestUtils';
import { createRequest, createResponse } from '../../../support/express';

runRequestContract('auth/password.js', {
  boundary: {
    argumentCount: 1,
    argumentKeys: ['token'],
    label: 'database.authDB.getResetPasswordToken',
  },
  success: {
    code: 0,
    payloadKeys: ['code', 'data', 'message'],
    status: 200,
  },
});

test('updates the password, reset digest, and audit record through one transactional database operation', async () => {
  jest.resetModules();
  const authDB = {
    getResetPasswordToken: jest.fn().mockResolvedValue({ expires_at: '2099-01-01T00:00:00.000Z', used_at: null, user_id: 7 }),
    getUserById: jest.fn().mockResolvedValue({ email: 'user@example.test', id: 7 }),
    insertActionHistory: jest.fn(),
    resetPassword: jest.fn().mockResolvedValue({ status: 'ok' }),
    updatePassword: jest.fn(),
    updateResetPasswordToken: jest.fn(),
  };
  const errorDB = { writeError: jest.fn() };
  const password = { hashPassword: jest.fn().mockResolvedValue('new-hash') };
  const sanitizer = { maskValue: jest.fn().mockReturnValue('[REDACTED]') };
  jest.doMock('@database', () => ({ authDB, errorDB }));
  jest.doMock('@libs', () => ({ password, sanitizer }));
  const { default: handler } = await import('../../../../src/requests/auth/password');
  const response = createResponse();

  await handler(createRequest({ body: { password: 'new-password', token: 'reset-token' }, originalUrl: '/auth/password' }), response);

  expect(authDB.resetPassword).toHaveBeenCalledWith({
    data: { new_password: '[REDACTED]', password_reset_token: '[REDACTED]' },
    password: 'new-hash',
    token: 'reset-token',
  });
  expect(authDB.updatePassword).not.toHaveBeenCalled();
  expect(authDB.updateResetPasswordToken).not.toHaveBeenCalled();
  expect(authDB.insertActionHistory).not.toHaveBeenCalled();
});

test.each([
  ['invalid', 'Invalid token.'],
  ['expired', 'Token expired.'],
  ['used', 'Token already used.'],
])('maps a transaction-time %s token race to the existing public error', async (status, message) => {
  jest.resetModules();
  const authDB = {
    getResetPasswordToken: jest.fn().mockResolvedValue({ expires_at: '2099-01-01T00:00:00.000Z', used_at: null, user_id: 7 }),
    getUserById: jest.fn().mockResolvedValue({ email: 'user@example.test', id: 7 }),
    resetPassword: jest.fn().mockResolvedValue({ status }),
  };
  const errorDB = { writeError: jest.fn() };
  jest.doMock('@database', () => ({ authDB, errorDB }));
  jest.doMock('@libs', () => ({
    password: { hashPassword: jest.fn().mockResolvedValue('new-hash') },
    sanitizer: { maskValue: jest.fn().mockReturnValue('[REDACTED]') },
  }));
  const { default: handler } = await import('../../../../src/requests/auth/password');
  const response = createResponse();

  await handler(createRequest({ body: { password: 'new-password', token: 'reset-token' }, originalUrl: '/auth/password' }), response);

  expect(response.status).toHaveBeenCalledWith(400);
  expect(response.json).toHaveBeenCalledWith({ message });
});
