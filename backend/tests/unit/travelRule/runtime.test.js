const mockTrpService = { createOutboundTransfer: jest.fn() };
const mockOrchestrationService = { createTransfer: jest.fn() };
const mockOutboxWorker = { processBatch: jest.fn() };
const mockCreateTravelRuleService = jest.fn(() => mockTrpService);
const mockCreateOrchestrationService = jest.fn(() => mockOrchestrationService);
const mockCreateOutboxWorker = jest.fn(() => mockOutboxWorker);
const mockReconciler = { processBatch: jest.fn() };
const mockCreateNativeTrpReconciler = jest.fn(() => mockReconciler);
const mockEmailService = { createInvitation: jest.fn() };
const mockEmailWorker = { processBatch: jest.fn() };
const mockCreateTravelRuleEmailService = jest.fn(() => mockEmailService);
const mockCreateTravelRuleEmailWorker = jest.fn(() => mockEmailWorker);

jest.mock('../../../src/travelRule/service', () => ({ createTravelRuleService: (...args) => mockCreateTravelRuleService(...args) }));
jest.mock('../../../src/travelRule/orchestration', () => ({ createOrchestrationService: (...args) => mockCreateOrchestrationService(...args) }));
jest.mock('../../../src/travelRule/outbox', () => ({ createOutboxWorker: (...args) => mockCreateOutboxWorker(...args) }));
jest.mock('../../../src/travelRule/reconciliation', () => ({ createNativeTrpReconciler: (...args) => mockCreateNativeTrpReconciler(...args) }));
jest.mock('../../../src/travelRule/email', () => ({
  createTravelRuleEmailService: (...args) => mockCreateTravelRuleEmailService(...args),
  createTravelRuleEmailWorker: (...args) => mockCreateTravelRuleEmailWorker(...args),
}));
jest.mock('../../../src/database', () => ({ orchestrationDB: { createTransferBundle: jest.fn() }, reencryptionDB: { claimBatch: jest.fn() }, travelRuleEmailDB: { claimBatch: jest.fn() } }));
jest.mock('../../../src/libs/mailer', () => ({ __esModule: true, default: { isEnabled: jest.fn(), sendTravelRuleAccessEmail: jest.fn() } }));

test('configures the native TRP compatibility service and protocol-neutral orchestration service together', async () => {
  const runtime = await import('../../../src/travelRule/runtime');
  const config = { encryptionKey: Buffer.alloc(32, 4) };

  expect(runtime.configureTravelRule(config)).toBe(mockTrpService);
  expect(runtime.getTravelRuleService()).toBe(mockTrpService);
  expect(runtime.getOrchestrationService()).toBe(mockOrchestrationService);
  expect(runtime.getOutboxWorker()).toBe(mockOutboxWorker);
  expect(runtime.getReencryptionWorker()).toEqual(expect.objectContaining({ createJob: expect.any(Function), processBatch: expect.any(Function) }));
  expect(runtime.getTravelRuleEmailService()).toBe(mockEmailService);
  expect(runtime.getTravelRuleEmailWorker()).toBe(mockEmailWorker);
  expect(mockCreateTravelRuleEmailService).toHaveBeenCalledWith(expect.objectContaining({ config, database: expect.any(Object), keyring: expect.objectContaining({ activeKeyId: 'primary' }) }));
  expect(mockCreateTravelRuleEmailWorker).toHaveBeenCalledWith(expect.objectContaining({ database: expect.any(Object), keyring: expect.objectContaining({ activeKeyId: 'primary' }) }));
  expect(mockCreateOrchestrationService).toHaveBeenCalledWith(
    expect.objectContaining({
      connectorRegistry: expect.objectContaining({ select: expect.any(Function) }),
      database: expect.objectContaining({ createTransferBundle: expect.any(Function) }),
      keyring: expect.objectContaining({ activeKeyId: 'primary' }),
    }),
  );
  expect(mockCreateOutboxWorker).toHaveBeenCalledWith(
    expect.objectContaining({
      connectorRegistry: expect.objectContaining({ get: expect.any(Function) }),
      database: expect.any(Object),
      keyring: expect.objectContaining({ activeKeyId: 'primary' }),
      reconciler: mockReconciler,
    }),
  );
});

test('uses configured active, retired, and legacy encryption keys for neutral records', async () => {
  const runtime = await import('../../../src/travelRule/runtime');
  const config = {
    encryptionKey: Buffer.alloc(32, 4),
    encryptionKeyring: {
      activeKeyId: 'current',
      keys: { current: Buffer.alloc(32, 4), previous: Buffer.alloc(32, 3) },
      legacyKeyId: 'previous',
    },
  };

  runtime.configureTravelRule(config);

  expect(mockCreateOrchestrationService).toHaveBeenLastCalledWith(
    expect.objectContaining({
      keyring: expect.objectContaining({ activeKeyId: 'current', legacyKeyId: 'previous' }),
    }),
  );
});

test('allows request tests to replace both runtime services explicitly', async () => {
  const runtime = await import('../../../src/travelRule/runtime');
  const replacement = { createTransfer: jest.fn() };

  runtime.setOrchestrationServiceForTests(replacement);

  expect(runtime.getOrchestrationService()).toBe(replacement);
});
