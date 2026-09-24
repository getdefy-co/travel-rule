import { runRequestContract } from '../requestTestUtils';
import { createRequest, createResponse } from '../../../support/express';

runRequestContract('auth/forgot.js', {
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

test('does not forward the removed platform field to the mailer', async () => {
  jest.resetModules();
  const authDB = {
    createResetPasswordToken: jest.fn(),
    getUser: jest.fn().mockResolvedValue({ id: 7 }),
    insertActionHistory: jest.fn(),
  };
  const errorDB = { writeError: jest.fn() };
  const mailer = { sendForgotPasswordEmail: jest.fn() };
  jest.doMock('@database', () => ({ authDB, errorDB }));
  jest.doMock('@libs', () => ({
    mailer,
    random: { generateAlphanumeric: jest.fn().mockReturnValue('reset-token') },
    sanitizer: { maskValue: jest.fn().mockReturnValue('[REDACTED]') },
  }));
  const { default: handler } = await import('../../../../src/requests/auth/forgot');
  const response = createResponse();

  await handler(createRequest({ body: { email: 'user@example.test', platform: 'vera' }, originalUrl: '/auth/forgot' }), response);

  expect(mailer.sendForgotPasswordEmail).toHaveBeenCalledWith({ email: 'user@example.test', token: 'reset-token' });
  expect(authDB.insertActionHistory).toHaveBeenCalledWith({
    action: 'forgot_password',
    data: { email: '[REDACTED]', password_reset_token: '[REDACTED]' },
    user_id: 7,
  });
});

test('returns the same generic 200 without side effects for an unknown email', async () => {
  jest.resetModules();
  const authDB = {
    createResetPasswordToken: jest.fn(),
    getUser: jest.fn().mockResolvedValue(null),
    insertActionHistory: jest.fn(),
  };
  const errorDB = { writeError: jest.fn() };
  const mailer = { sendForgotPasswordEmail: jest.fn() };
  jest.doMock('@database', () => ({ authDB, errorDB }));
  jest.doMock('@libs', () => ({
    mailer,
    random: { generateAlphanumeric: jest.fn() },
    sanitizer: { maskValue: jest.fn() },
  }));
  const { default: handler } = await import('../../../../src/requests/auth/forgot');
  const response = createResponse();

  await handler(createRequest({ body: { email: 'unknown@example.test' }, originalUrl: '/auth/forgot' }), response);

  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json).toHaveBeenCalledWith({
    code: 0,
    data: null,
    message: 'If the email is registered, you will receive password reset instructions.',
  });
  expect(authDB.createResetPasswordToken).not.toHaveBeenCalled();
  expect(authDB.insertActionHistory).not.toHaveBeenCalled();
  expect(mailer.sendForgotPasswordEmail).not.toHaveBeenCalled();
});
