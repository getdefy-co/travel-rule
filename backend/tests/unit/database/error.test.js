import { pool } from '../../../src/database/postgres';
import errorDB from '../../../src/database/error';
import logger from '../../../src/libs/logger';

jest.mock('../../../src/database/postgres', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../../src/libs/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

describe('error database boundary', () => {
  beforeEach(() => {
    pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  test('exports only the error-writing surface', () => {
    expect(Object.keys(errorDB)).toEqual(['writeError']);
  });

  test('redacts provider values, URL secrets, and nested PII at the persistence boundary', async () => {
    await expect(
      errorDB.writeError({
        name: 'handler',
        message: 'database rejected alice@example.test with provider-secret',
        status: 500,
        url: '/auth/password/reset-secret?token=query-secret&status=failed',
        details: { body: { customerNumber: 'customer-123', email: 'alice@example.test' }, retryCount: 2 },
      }),
    ).resolves.toBe(true);
    expect(pool.query).toHaveBeenCalledWith('INSERT INTO error_logs (function_name, message, status, url, details) VALUES ($1, $2, $3, $4, $5)', [
      'handler',
      '[REDACTED]',
      500,
      '/auth/password/[REDACTED]?token=[REDACTED]&status=failed',
      { body: '[REDACTED]', retryCount: 2 },
    ]);
    expect(JSON.stringify(pool.query.mock.calls)).not.toContain('alice@example.test');
    expect(JSON.stringify(pool.query.mock.calls)).not.toContain('provider-secret');
    expect(JSON.stringify(pool.query.mock.calls)).not.toContain('query-secret');
    expect(logger.error).toHaveBeenCalledWith('handler - Error recorded.');
  });

  test('does not copy persistence-provider errors into fallback logs', async () => {
    pool.query.mockRejectedValueOnce(new Error('database unavailable for alice@example.test with provider-secret'));

    await expect(errorDB.writeError({ name: 'handler', message: 'failed', status: 500 })).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalledWith('handler - Error persistence failed.');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('alice@example.test');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('provider-secret');
  });

  test('redacts email aliases in URL and structured fields before the database call', async () => {
    await expect(
      errorDB.writeError({
        name: 'handler',
        message: 'email alias failure',
        status: 500,
        url: '/auth/lookup?contactEmail=contact%40example.test&sender_email=sender%40example.test',
        details: { billingEmail: 'billing@example.test', retryCount: 1 },
      }),
    ).resolves.toBe(true);

    expect(pool.query).toHaveBeenCalledWith('INSERT INTO error_logs (function_name, message, status, url, details) VALUES ($1, $2, $3, $4, $5)', [
      'handler',
      '[REDACTED]',
      500,
      '/auth/lookup?contactEmail=[REDACTED]&sender_email=[REDACTED]',
      { billingEmail: '[REDACTED]', retryCount: 1 },
    ]);
    expect(JSON.stringify(pool.query.mock.calls)).not.toMatch(/contact%40example\.test|sender%40example\.test|billing@example\.test/);
  });
});
