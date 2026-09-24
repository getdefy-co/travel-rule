import { createConnectorRegistry, createNativeTrpConnector } from '../../../src/travelRule/connectors';

const createConnector = (key, capabilities) => ({
  capabilities,
  confirmSettlement: jest.fn(),
  createOutboundExchange: jest.fn(),
  discoverCounterparty: jest.fn(),
  handleInbound: jest.fn(),
  health: jest.fn(),
  key,
  normalizeStatus: jest.fn(),
  sendDecision: jest.fn(),
  validateConfig: jest.fn(),
});

test('selects the first configured connector that satisfies every required capability', () => {
  const registry = createConnectorRegistry({
    connectors: [createConnector('sumsub', ['beneficiary_match', 'counterparty_discovery']), createConnector('native_trp', ['async_callback', 'ivms101_exchange'])],
  });

  expect(
    registry.select({
      candidateKeys: ['sumsub', 'native_trp'],
      requiredCapabilities: ['ivms101_exchange'],
    }),
  ).toMatchObject({ key: 'native_trp' });
});

test('does not select a second connector after PII disclosure without explicit policy approval', () => {
  const registry = createConnectorRegistry({
    connectors: [createConnector('native_trp', ['ivms101_exchange']), createConnector('sumsub', ['ivms101_exchange'])],
  });

  expect(
    registry.select({
      candidateKeys: ['sumsub'],
      previousExchange: { connectorKey: 'native_trp', piiDisclosed: true },
      requiredCapabilities: ['ivms101_exchange'],
    }),
  ).toBeNull();

  expect(
    registry.select({
      allowPiiFallback: true,
      candidateKeys: ['sumsub'],
      previousExchange: { connectorKey: 'native_trp', piiDisclosed: true },
      requiredCapabilities: ['ivms101_exchange'],
    }),
  ).toMatchObject({ key: 'sumsub' });
});

test('rejects duplicate, unknown-capability, and incomplete connectors', () => {
  expect(() => createConnectorRegistry({ connectors: [createConnector('native_trp', ['unknown'])] })).toThrow('Invalid connector contract.');

  const duplicate = createConnector('native_trp', ['ivms101_exchange']);

  expect(() => createConnectorRegistry({ connectors: [duplicate, { ...duplicate }] })).toThrow('Duplicate connector key.');

  expect(() => createConnectorRegistry({ connectors: [{ ...duplicate, health: undefined }] })).toThrow('Invalid connector contract.');
});

test('adapts the existing TRP service without changing its public request shapes', async () => {
  const service = {
    confirmTransfer: jest.fn().mockResolvedValue({ result: { state: 'confirmed' } }),
    createOutboundTransfer: jest.fn().mockResolvedValue({ result: { state: 'pending' } }),
    decideInquiry: jest.fn().mockResolvedValue({ result: { state: 'approved' } }),
    receiveInquiry: jest.fn().mockResolvedValue({ transfer: { state: 'pending' } }),
  };
  const connector = createNativeTrpConnector({ service });
  const outbound = { amount: '2', asset: { dti: '4H95J0R2X' }, ivms101: {}, travelAddress: 'ta-value' };

  await expect(connector.createOutboundExchange(outbound)).resolves.toEqual({ result: { state: 'pending' } });
  await expect(connector.handleInbound({ body: {}, phase: 'inquiry' })).resolves.toEqual({ transfer: { state: 'pending' } });
  await expect(connector.sendDecision({ decision: 'approved', id: 'transfer-id' })).resolves.toEqual({ result: { state: 'approved' } });
  await expect(connector.confirmSettlement({ id: 'transfer-id', txid: 'chain-tx' })).resolves.toEqual({ result: { state: 'confirmed' } });
  expect(service.createOutboundTransfer).toHaveBeenCalledWith(outbound);
  expect(service.receiveInquiry).toHaveBeenCalledWith({ body: {}, phase: 'inquiry' });
});

test('maps a protocol-neutral orchestration payload to the existing TRP service contract', async () => {
  const service = { createOutboundTransfer: jest.fn().mockResolvedValue({ result: { id: 'trp-id', state: 'pending' } }) };
  const connector = createNativeTrpConnector({ service });

  await connector.createOutboundExchange({
    asset: { amount: '2', dti: '4H95J0R2X' },
    counterparty: { travel_address: 'ta-value' },
    orchestration_exchange_id: 'exchange-id',
    parties: { ivms101: { originator: {} } },
  });

  expect(service.createOutboundTransfer).toHaveBeenCalledWith({
    amount: '2',
    asset: { dti: '4H95J0R2X' },
    idempotencyId: 'exchange-id',
    ivms101: { originator: {} },
    travelAddress: 'ta-value',
  });
});

test.each([
  ['pending', 'awaiting_counterparty'],
  ['approved', 'completed'],
  ['rejected', 'completed'],
  ['confirmed', 'completed'],
  ['canceled', 'canceled'],
  ['expired', 'failed'],
])('normalizes TRP state %s to exchange state %s', (state, expected) => {
  const connector = createNativeTrpConnector({ service: {} });

  expect(connector.normalizeStatus({ state })).toBe(expected);
});
