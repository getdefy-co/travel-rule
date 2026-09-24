const poolInstances = [];
const mockLogger = { error: jest.fn() };

jest.mock('pg', () => ({
  Pool: jest.fn(options => {
    const instance = { options, query: jest.fn(), connect: jest.fn(), on: jest.fn() };
    poolInstances.push(instance);
    return instance;
  }),
}));
jest.mock('../../../src/libs/logger', () => ({ __esModule: true, default: mockLogger }));

describe('database/postgres', () => {
  beforeEach(() => {
    jest.resetModules();
    poolInstances.length = 0;
    process.env.DATABASE_URL = 'postgres://main.example.test/db';
    process.env.DATABASE_CONNECTION_TIMEOUT_MS = '2345';
    process.env.DATABASE_QUERY_TIMEOUT_MS = '3456';
  });

  test('creates only the bounded main application pool', async () => {
    let postgres;
    await jest.isolateModulesAsync(async () => {
      postgres = await import('../../../src/database/postgres');
    });

    expect(poolInstances.map(instance => instance.options)).toEqual([
      {
        connectionString: 'postgres://main.example.test/db',
        connectionTimeoutMillis: 2345,
        query_timeout: 3456,
      },
    ]);
    expect(postgres.pool).toBe(poolInstances[0]);
    expect(Object.keys(postgres)).toEqual(['pool']);
  });

  test('sanitizes unexpected idle-client errors without crashing the process', async () => {
    await jest.isolateModulesAsync(async () => {
      await import('../../../src/database/postgres');
    });
    const errorListener = poolInstances[0].on.mock.calls.find(([event]) => event === 'error')?.[1];

    expect(errorListener).toEqual(expect.any(Function));
    expect(() => errorListener(new Error('postgres://secret@database/private'))).not.toThrow();
    expect(mockLogger.error).toHaveBeenCalledWith('[Database] Unexpected PostgreSQL pool error.');
  });
});
