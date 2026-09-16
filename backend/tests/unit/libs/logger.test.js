const mockAddColors = jest.fn();
const mockCreateLogger = jest.fn(options => ({ options }));
const mockCombine = jest.fn((...formats) => ({ formats }));
const mockTimestamp = jest.fn(options => ({ type: 'timestamp', options }));
const mockColorize = jest.fn(options => ({ type: 'colorize', options }));
const mockPrintf = jest.fn(callback => ({ type: 'printf', rendered: callback({ timestamp: '2026-01-02', level: 'info', message: 'ready' }) }));
const mockConsole = jest.fn(options => ({ type: 'console', options }));
const mockFile = jest.fn(options => ({ type: 'file', options }));

jest.mock('winston', () => ({
  addColors: mockAddColors,
  createLogger: mockCreateLogger,
  format: { combine: mockCombine, timestamp: mockTimestamp, colorize: mockColorize, printf: mockPrintf },
  transports: { Console: mockConsole, File: mockFile },
}));

describe('logger', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    jest.resetModules();

    if (originalEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test.each([
    ['development', 'debug'],
    ['production', 'warn'],
    [undefined, 'debug'],
  ])('selects %s logging behavior', (environment, expectedLevel) => {
    if (environment === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = environment;
    }

    let logger;
    jest.isolateModules(() => {
      logger = jest.requireActual('../../../src/libs/logger').default;
    });
    expect(logger.options.level).toBe(expectedLevel);
    expect(logger.options.transports).toEqual([{ type: 'console', options: { stderrLevels: ['error'] } }]);
    expect(mockFile).not.toHaveBeenCalled();
    expect(mockAddColors).toHaveBeenCalledWith({ error: 'red', warn: 'yellow', info: 'green', http: 'magenta', debug: 'white' });
    expect(mockPrintf.mock.results.at(-1).value.rendered).toBe('2026-01-02 info: ready');
  });
});
