import { createTravelRuleService } from '../../../src/travelRule/service';

const config = {
  clientCaPath: '/certs/ca.pem',
  clientCertPath: '/certs/client.pem',
  clientKeyPath: '/certs/client-key.pem',
  encryptionKey: Buffer.alloc(32, 7),
  httpTimeoutMs: 10000,
  lei: '5493001KJTIIGC8Y1R12',
  name: 'Example VASP',
  publicBaseUrl: 'https://localhost:3008',
  retentionDays: 1825,
  tokenTtlSeconds: 3600,
};

test('does not persist a transfer when its Travel Address URL cannot be encoded', async () => {
  const database = { createTransfer: jest.fn() };
  const service = createTravelRuleService({
    config,
    database,
    readFile: jest.fn(() => Buffer.from('test-certificate')),
  });

  await expect(service.createTravelAddress({ beneficiaryReference: 'manual-beneficiary-001' })).rejects.toThrow('Invalid Travel Address URL.');
  expect(database.createTransfer).not.toHaveBeenCalled();
});

test('derives management retry eligibility from the configured delivery timeout', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-08-26T12:00:00.000Z'));
  const service = createTravelRuleService({
    config,
    database: {},
    readFile: jest.fn(() => Buffer.from('test-certificate')),
  });

  expect(service.getRetryBefore()).toEqual(new Date('2026-08-26T11:59:40.000Z'));
  jest.useRealTimers();
});

test('reuses a previously persisted outbound transfer for an orchestration idempotency identifier', async () => {
  const existing = {
    amount: '2',
    asset_dti: '4H95J0R2X',
    created_at: '2026-08-27T10:00:00.000Z',
    direction: 'outbound',
    expires_at: '2026-08-27T11:00:00.000Z',
    id: 'exchange-id',
    protocol: 'TRP',
    state: 'pending',
    updated_at: '2026-08-27T10:00:00.000Z',
  };
  const database = { createTransfer: jest.fn(), getTransfer: jest.fn().mockResolvedValue(existing) };
  const service = createTravelRuleService({
    config,
    database,
    readFile: jest.fn(() => Buffer.from('test-certificate')),
  });

  await expect(service.createOutboundTransfer({ amount: '2', asset: { dti: '4H95J0R2X' }, idempotencyId: 'exchange-id', ivms101: {}, travelAddress: 'invalid' })).resolves.toEqual({
    httpStatus: 200,
    result: expect.objectContaining({ id: 'exchange-id', state: 'pending' }),
  });
  expect(database.createTransfer).not.toHaveBeenCalled();
});
