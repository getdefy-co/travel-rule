jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
jest.mock('fs', () => ({ readFileSync: jest.fn(() => '<p>{{userEmail}} {{url}} {{currentYear}}</p>') }));
jest.mock('@libs', () => ({ logger: { info: jest.fn(), error: jest.fn() } }));
jest.mock('@database', () => ({ errorDB: { writeError: jest.fn().mockResolvedValue(undefined) } }));

const nodemailer = require('nodemailer');
const fs = require('fs');
const { errorDB } = require('@database');
const { logger } = require('@libs');

const smtpConfig = {
  frontendUrl: 'https://app.test',
  host: 'smtp.test',
  mode: 'smtp',
  password: 'smtp-password',
  port: 587,
  secure: false,
  user: 'sender@test',
};

const loadMailer = async ({ sendResult = {}, verifyResult = undefined } = {}) => {
  const transport = {
    sendMail: jest.fn().mockResolvedValue(sendResult),
    verify: jest.fn().mockResolvedValue(verifyResult),
  };

  nodemailer.createTransport.mockReturnValue(transport);
  let mailer;
  await jest.isolateModulesAsync(async () => {
    mailer = (await import('../../../src/libs/mailer')).default;
  });

  return { mailer, transport };
};

describe('mailer', () => {
  test('disabled mode performs no SMTP or template work', async () => {
    const { mailer, transport } = await loadMailer();

    await expect(mailer.configure({ mode: 'disabled' })).resolves.toBeUndefined();
    await expect(mailer.sendWelcomeEmail({ email: 'alice@test', token: 'token' })).resolves.toBeUndefined();
    await expect(mailer.sendForgotPasswordEmail({ email: 'alice@test', token: 'token' })).resolves.toBeUndefined();
    await expect(mailer.sendTravelRuleAccessEmail({ email: 'alice@test', token: 'token' })).rejects.toThrow('Email delivery is disabled.');
    expect(mailer.isEnabled()).toBe(false);

    expect(nodemailer.createTransport).not.toHaveBeenCalled();
    expect(transport.verify).not.toHaveBeenCalled();
    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  test('SMTP mode verifies the external transport before it is used', async () => {
    const { mailer, transport } = await loadMailer();

    await expect(mailer.configure(smtpConfig)).resolves.toBeUndefined();
    expect(mailer.isEnabled()).toBe(true);

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      auth: { pass: 'smtp-password', user: 'sender@test' },
      host: 'smtp.test',
      port: 587,
      secure: false,
    });
    expect(transport.verify).toHaveBeenCalledTimes(1);
  });

  test('SMTP verification fails with sanitized application output', async () => {
    const { mailer, transport } = await loadMailer();

    transport.verify.mockRejectedValue(new Error('smtp-password smtp.test rejected sender@test'));

    await expect(mailer.configure(smtpConfig)).rejects.toThrow('SMTP initialization failed.');
    expect(logger.error).toHaveBeenCalledWith('[MAILER] SMTP initialization failed.');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('smtp-password');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('sender@test');
  });

  test.each([
    ['sendWelcomeEmail', { email: 'alice@test', token: 'welcome' }, 'Welcome to Defy', 'https://app.test/login?rpt=welcome&t=0'],
    ['sendForgotPasswordEmail', { email: 'alice@test', token: 'forgot' }, 'Reset Your Password', 'https://app.test/login?rpt=forgot&t=1'],
  ])('%s renders and sends its template in SMTP mode', async (method, params, subject, expectedUrl) => {
    const { mailer, transport } = await loadMailer();
    await mailer.configure(smtpConfig);

    await mailer[method](params);

    expect(transport.sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'Defy <sender@test>', to: 'alice@test', subject, html: expect.stringContaining(expectedUrl) }));
  });

  test('sends a generic Travel Rule access link without transfer PII', async () => {
    const { mailer, transport } = await loadMailer();
    await mailer.configure(smtpConfig);

    await expect(mailer.sendTravelRuleAccessEmail({ email: 'recipient@test', token: 'magic-token' })).resolves.toBeUndefined();

    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Defy <sender@test>',
        html: expect.stringContaining('https://app.test/travel-rule/shared#token=magic-token'),
        subject: 'Travel Rule transfer details',
        to: 'recipient@test',
      }),
    );
    expect(transport.sendMail.mock.calls[0][0].html).not.toMatch(/DTI|amount|originator|beneficiary/i);
  });

  test('rejects Travel Rule SMTP failures with a sanitized worker error', async () => {
    const { mailer, transport } = await loadMailer();
    await mailer.configure(smtpConfig);
    transport.sendMail.mockRejectedValue(new Error('smtp-password rejected recipient@test'));

    await expect(mailer.sendTravelRuleAccessEmail({ email: 'recipient@test', token: 'magic-token' })).rejects.toThrow('Travel Rule email delivery failed.');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('recipient@test');
    expect(JSON.stringify(errorDB.writeError.mock.calls)).not.toContain('recipient@test');
  });

  test.each(['sendWelcomeEmail', 'sendForgotPasswordEmail'])('%s records SMTP errors without rejecting or disclosing provider output', async method => {
    const { mailer, transport } = await loadMailer();
    await mailer.configure(smtpConfig);
    transport.sendMail.mockRejectedValue({ message: 'smtp-password rejected alice@test', response: { status: 503 } });

    await expect(mailer[method]({ email: 'alice@test', token: 'token' })).resolves.toBeUndefined();

    expect(errorDB.writeError).toHaveBeenCalledWith(expect.objectContaining({ name: `libs/mailer/${method}`, message: 'Email delivery failed.', status: 503 }));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Email delivery failed.'));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('alice@test');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('smtp-password');
  });

  test.each([
    [{ statusCode: 418 }, 418],
    [{}, 500],
  ])('normalizes SMTP provider status metadata without exposing the provider error', async (providerError, expectedStatus) => {
    const { mailer, transport } = await loadMailer();
    await mailer.configure(smtpConfig);
    transport.sendMail.mockRejectedValue(providerError);

    await expect(mailer.sendWelcomeEmail({ email: 'alice@test', token: 'token' })).resolves.toBeUndefined();

    expect(errorDB.writeError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Email delivery failed.', status: expectedStatus }));
  });
});
