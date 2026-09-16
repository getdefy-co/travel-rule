import { startRuntime } from '../../src/runtime';

const createServer = name => {
  const listeners = new Map();
  const server = {
    emit: (event, error) => listeners.get(event)?.(error),
    listen: jest.fn((_port, callback) => callback()),
    listeners,
    name,
    once: jest.fn((event, listener) => listeners.set(event, listener)),
    removeListener: jest.fn((event, listener) => {
      if (listeners.get(event) === listener) {
        listeners.delete(event);
      }
    }),
  };

  return server;
};

const createHarness = config => {
  const internalApp = { kind: 'internal-app' };
  const publicApp = { kind: 'public-app' };
  const internalServer = createServer('internal');
  const publicServer = createServer('public');
  const signalHandlers = new Map();
  const timer = { kind: 'cleanup-timer' };
  const outboxTimer = { kind: 'outbox-timer' };
  const emailTimer = { kind: 'email-timer' };
  const service = { kind: 'travel-rule-service' };
  const outboxWorker = { kind: 'outbox-worker' };
  const emailWorker = { kind: 'email-worker' };
  const dependencies = {
    clearTimer: jest.fn(),
    closeServer: jest.fn().mockResolvedValue(undefined),
    configureMailer: jest.fn().mockResolvedValue(undefined),
    configureTravelRule: jest.fn(() => service),
    createHttpServer: jest.fn(() => internalServer),
    createInternalApp: jest.fn(() => internalApp),
    createPublicApp: jest.fn(() => publicApp),
    createPublicTlsServer: jest.fn(() => publicServer),
    loadRuntimeConfig: jest.fn(() => config),
    logger: { error: jest.fn(), info: jest.fn() },
    initializeServiceApiKey: jest.fn().mockResolvedValue(config.trp?.serviceApiKey || 'persisted-service-api-key'),
    getOutboxWorker: jest.fn(() => outboxWorker),
    getTravelRuleEmailWorker: jest.fn(() => emailWorker),
    validateDatabaseSchema: jest.fn().mockResolvedValue(undefined),
    pool: { end: jest.fn().mockResolvedValue(undefined) },
    processTarget: {
      exitCode: 0,
      once: jest.fn((signal, handler) => signalHandlers.set(signal, handler)),
    },
    startCleanupSchedule: jest.fn().mockResolvedValue(timer),
    startEmailSchedule: jest.fn().mockResolvedValue(emailTimer),
    startOutboxSchedule: jest.fn().mockResolvedValue(outboxTimer),
  };

  return { dependencies, emailTimer, emailWorker, internalApp, internalServer, outboxTimer, outboxWorker, publicApp, publicServer, service, signalHandlers, timer };
};

test('starts one internal HTTP listener on PORT in Auth-only mode', async () => {
  const config = { corsOrigins: [], email: { mode: 'disabled' }, port: 3000, protocol: null, trp: null, trpPort: null };
  const harness = createHarness(config);

  const runtime = await startRuntime(harness.dependencies);

  expect(harness.dependencies.processTarget.once.mock.invocationCallOrder[0]).toBeLessThan(harness.dependencies.loadRuntimeConfig.mock.invocationCallOrder[0]);
  expect(harness.dependencies.configureMailer).toHaveBeenCalledWith(config.email);
  expect(harness.dependencies.validateDatabaseSchema).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.validateDatabaseSchema.mock.invocationCallOrder[0]).toBeLessThan(harness.dependencies.configureMailer.mock.invocationCallOrder[0]);
  expect(harness.dependencies.configureMailer.mock.invocationCallOrder[0]).toBeLessThan(harness.dependencies.createInternalApp.mock.invocationCallOrder[0]);
  expect(harness.dependencies.createInternalApp).toHaveBeenCalledWith({ config: expect.objectContaining({ port: 3000 }) });
  expect(harness.dependencies.createHttpServer).toHaveBeenCalledWith(harness.internalApp);
  expect(harness.internalServer.listen).toHaveBeenCalledWith(3000, expect.any(Function));
  expect(harness.dependencies.createPublicApp).not.toHaveBeenCalled();
  expect(harness.dependencies.createPublicTlsServer).not.toHaveBeenCalled();
  expect(harness.dependencies.startCleanupSchedule).not.toHaveBeenCalled();
  expect(harness.dependencies.startOutboxSchedule).not.toHaveBeenCalled();
  expect(harness.dependencies.startEmailSchedule).not.toHaveBeenCalled();
  expect(runtime.servers).toEqual([harness.internalServer]);
});

test('fails closed before external initialization when database schema validation fails', async () => {
  const config = { corsOrigins: [], email: { mode: 'disabled' }, port: 3000, protocol: null, trp: null, trpPort: null };
  const harness = createHarness(config);
  harness.dependencies.validateDatabaseSchema.mockRejectedValue(new Error('Database schema is not canonical.'));

  await expect(startRuntime(harness.dependencies)).rejects.toThrow('Database schema is not canonical.');

  expect(harness.dependencies.configureMailer).not.toHaveBeenCalled();
  expect(harness.dependencies.createInternalApp).not.toHaveBeenCalled();
  expect(harness.dependencies.pool.end).toHaveBeenCalledTimes(1);
});

test('fails before creating listeners when external SMTP verification fails', async () => {
  const config = { corsOrigins: [], email: { mode: 'smtp' }, port: 3000, protocol: null, trp: null, trpPort: null };
  const harness = createHarness(config);
  harness.dependencies.configureMailer.mockRejectedValue(new Error('SMTP initialization failed.'));

  await expect(startRuntime(harness.dependencies)).rejects.toThrow('SMTP initialization failed.');

  expect(harness.dependencies.createInternalApp).not.toHaveBeenCalled();
  expect(harness.dependencies.createHttpServer).not.toHaveBeenCalled();
  expect(harness.dependencies.pool.end).toHaveBeenCalledTimes(1);
});

test('fails before listeners when persisted TRP configuration is invalid', async () => {
  const config = { corsOrigins: [], port: 3002, protocol: 'TRP', trp: { lei: '5493001KJTIIGC8Y1R12' }, trpPort: 3001 };
  const harness = createHarness(config);
  harness.dependencies.initializeServiceApiKey.mockRejectedValue(new Error('Unable to load TRP configuration.'));

  await expect(startRuntime(harness.dependencies)).rejects.toThrow('Unable to load TRP configuration.');
  expect(harness.internalServer.listen).not.toHaveBeenCalled();
  expect(harness.publicServer.listen).not.toHaveBeenCalled();
  expect(harness.dependencies.configureTravelRule).not.toHaveBeenCalled();
});

test('starts separate internal HTTP and public TLS listeners in exact TRP mode', async () => {
  const config = { corsOrigins: [], port: 3002, protocol: 'TRP', trp: { lei: '5493001KJTIIGC8Y1R12' }, trpPort: 3001 };
  const harness = createHarness(config);

  const runtime = await startRuntime(harness.dependencies);

  expect(harness.dependencies.configureTravelRule).toHaveBeenCalledWith(config.trp);
  expect(harness.dependencies.startCleanupSchedule).toHaveBeenCalledWith(harness.service);
  expect(harness.dependencies.getOutboxWorker).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.startOutboxSchedule).toHaveBeenCalledWith(harness.outboxWorker);
  expect(harness.dependencies.startEmailSchedule).toHaveBeenCalledWith(harness.emailWorker);
  expect(harness.dependencies.createPublicApp).toHaveBeenCalledWith({ config });
  expect(harness.dependencies.createPublicTlsServer).toHaveBeenCalledWith({ app: harness.publicApp, config });
  expect(harness.internalServer.listen).toHaveBeenCalledWith(3002, expect.any(Function));
  expect(harness.publicServer.listen).toHaveBeenCalledWith(3001, expect.any(Function));
  expect(runtime.servers).toEqual([harness.internalServer, harness.publicServer]);
});

test('repeated shutdown signals close both listeners, cleanup timer, and pool exactly once', async () => {
  const config = { corsOrigins: [], port: 3002, protocol: 'TRP', trp: { lei: '5493001KJTIIGC8Y1R12' }, trpPort: 3001 };
  const harness = createHarness(config);

  const runtime = await startRuntime(harness.dependencies);
  await Promise.all([runtime.shutdown(), harness.signalHandlers.get('SIGTERM')(), harness.signalHandlers.get('SIGINT')()]);

  expect(harness.dependencies.clearTimer).toHaveBeenCalledTimes(3);
  expect(harness.dependencies.clearTimer).toHaveBeenCalledWith(harness.timer);
  expect(harness.dependencies.clearTimer).toHaveBeenCalledWith(harness.outboxTimer);
  expect(harness.dependencies.clearTimer).toHaveBeenCalledWith(harness.emailTimer);
  expect(harness.dependencies.closeServer).toHaveBeenCalledTimes(2);
  expect(harness.dependencies.closeServer).toHaveBeenCalledWith(harness.internalServer);
  expect(harness.dependencies.closeServer).toHaveBeenCalledWith(harness.publicServer);
  expect(harness.dependencies.pool.end).toHaveBeenCalledTimes(1);
});

test('cleans started resources when the public listener fails during startup', async () => {
  const config = { corsOrigins: [], port: 3002, protocol: 'TRP', trp: { lei: '5493001KJTIIGC8Y1R12' }, trpPort: 3001 };
  const harness = createHarness(config);
  harness.publicServer.listen.mockImplementation(() => {
    throw new Error('TLS listener failed with /private/certificate/path');
  });

  await expect(startRuntime(harness.dependencies)).rejects.toThrow('TLS listener failed');

  expect(harness.dependencies.clearTimer).toHaveBeenCalledTimes(3);
  expect(harness.dependencies.closeServer).toHaveBeenCalledTimes(2);
  expect(harness.dependencies.closeServer).toHaveBeenCalledWith(harness.internalServer);
  expect(harness.dependencies.closeServer).toHaveBeenCalledWith(harness.publicServer);
  expect(harness.dependencies.pool.end).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.processTarget.once).toHaveBeenCalledTimes(2);
  expect(harness.publicServer.once).toHaveBeenCalledWith('error', expect.any(Function));
});

test('fails before listeners and cleans the retention timer when initial outbox drain fails', async () => {
  const config = { corsOrigins: [], port: 3002, protocol: 'TRP', trp: { lei: '5493001KJTIIGC8Y1R12' }, trpPort: 3001 };
  const harness = createHarness(config);
  harness.dependencies.startOutboxSchedule.mockRejectedValue(new Error('Unable to claim outbox jobs.'));

  await expect(startRuntime(harness.dependencies)).rejects.toThrow('Unable to claim outbox jobs.');

  expect(harness.dependencies.clearTimer).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.clearTimer).toHaveBeenCalledWith(harness.timer);
  expect(harness.internalServer.listen).not.toHaveBeenCalled();
  expect(harness.publicServer.listen).not.toHaveBeenCalled();
});

test('closes the pool when TRP cleanup initialization fails before listeners start', async () => {
  const config = { corsOrigins: [], port: 3002, protocol: 'TRP', trp: { lei: '5493001KJTIIGC8Y1R12' }, trpPort: 3001 };
  const harness = createHarness(config);
  harness.dependencies.startCleanupSchedule.mockRejectedValue(new Error('database.example.test/private-detail'));

  await expect(startRuntime(harness.dependencies)).rejects.toThrow('database.example.test');

  expect(harness.dependencies.closeServer).toHaveBeenCalledTimes(2);
  expect(harness.dependencies.closeServer).toHaveBeenCalledWith(harness.internalServer);
  expect(harness.dependencies.closeServer).toHaveBeenCalledWith(harness.publicServer);
  expect(harness.dependencies.pool.end).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.processTarget.once).toHaveBeenCalledTimes(2);
});

test('a signal during cleanup initialization owns later timer cleanup and prevents listeners from starting', async () => {
  const config = { corsOrigins: [], port: 3002, protocol: 'TRP', trp: { lei: '5493001KJTIIGC8Y1R12' }, trpPort: 3001 };
  const harness = createHarness(config);
  let resolveTimer;

  harness.dependencies.startCleanupSchedule.mockReturnValue(
    new Promise(resolve => {
      resolveTimer = resolve;
    }),
  );
  const startup = startRuntime(harness.dependencies);
  await new Promise(resolve => {
    setImmediate(resolve);
  });
  const signal = harness.signalHandlers.get('SIGTERM')();

  resolveTimer(harness.timer);
  await signal;
  await expect(startup).rejects.toThrow('Startup interrupted');

  expect(harness.dependencies.clearTimer).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.clearTimer).toHaveBeenCalledWith(harness.timer);
  expect(harness.dependencies.closeServer).toHaveBeenCalledTimes(2);
  expect(harness.dependencies.pool.end).toHaveBeenCalledTimes(1);
  expect(harness.internalServer.listen).not.toHaveBeenCalled();
  expect(harness.publicServer.listen).not.toHaveBeenCalled();
});

test('a signal during listener startup closes the created server and pool', async () => {
  const harness = createHarness({ corsOrigins: [], port: 3000, protocol: null, trp: null, trpPort: null });

  harness.internalServer.listen.mockImplementation(() => {});
  harness.dependencies.closeServer.mockImplementation(async server => {
    server.emit('error', new Error('server closed during startup'));
  });
  const startup = startRuntime(harness.dependencies);
  await new Promise(resolve => {
    setImmediate(resolve);
  });

  await harness.signalHandlers.get('SIGINT')();
  await expect(startup).rejects.toThrow('server closed during startup');

  expect(harness.dependencies.closeServer).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.closeServer).toHaveBeenCalledWith(harness.internalServer);
  expect(harness.dependencies.pool.end).toHaveBeenCalledTimes(1);
});

test('signal wrapper consumes shutdown rejection and logs only a generic failure', async () => {
  const harness = createHarness({ corsOrigins: [], port: 3000, protocol: null, trp: null, trpPort: null });

  await startRuntime(harness.dependencies);
  harness.dependencies.closeServer.mockRejectedValue(new Error('TLS /private/key.pem postgres://secret'));

  await expect(harness.signalHandlers.get('SIGTERM')()).resolves.toBeUndefined();

  expect(harness.dependencies.logger.error).toHaveBeenCalledWith('[Runtime] Shutdown failed.');
  expect(harness.dependencies.logger.error).not.toHaveBeenCalledWith(expect.stringContaining('/private/key.pem'));
  expect(harness.dependencies.processTarget.exitCode).toBe(1);
});
