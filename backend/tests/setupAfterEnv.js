import nock from 'nock';

const originalEnv = { ...process.env };

nock.disableNetConnect();

afterEach(() => {
  const pendingMocks = nock.pendingMocks();

  nock.abortPendingRequests();
  nock.cleanAll();
  jest.useRealTimers();

  Object.keys(process.env).forEach(key => {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  });
  Object.assign(process.env, originalEnv);

  if (pendingMocks.length > 0) {
    throw new Error(`Unused HTTP mocks: ${pendingMocks.join(', ')}`);
  }
});

afterAll(() => {
  nock.enableNetConnect();
});
