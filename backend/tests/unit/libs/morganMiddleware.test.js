const mockMorgan = jest.fn((_format, options) => options);
const formatters = new Map();
mockMorgan.token = jest.fn((name, formatter) => {
  formatters.set(name, formatter);
});
const mockLogger = { http: jest.fn() };

jest.mock('morgan', () => mockMorgan);
jest.mock('../../../src/libs/logger', () => ({ __esModule: true, default: mockLogger }));

const middleware = jest.requireActual('../../../src/libs/morganMiddleware').default;

describe('morganMiddleware', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test('forwards access messages to the logger and only runs in development', () => {
    middleware.stream.write('GET /health 200');
    expect(mockLogger.http).toHaveBeenCalledWith('GET /health 200');
    process.env.NODE_ENV = 'development';
    expect(middleware.skip()).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(middleware.skip()).toBe(true);
    delete process.env.NODE_ENV;
    expect(middleware.skip()).toBe(false);
  });

  test('registers a URL token that redacts protocol bearer tokens', () => {
    const formatter = formatters.get('safe-url');
    expect(formatter({ originalUrl: '/travel-rule/trp/protocol/inquiries/sentinel-secret?t=i' })).toBe('/travel-rule/trp/protocol/inquiries/[REDACTED]?t=i');
  });
});
