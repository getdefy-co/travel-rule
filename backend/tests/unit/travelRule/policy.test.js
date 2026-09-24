import { evaluatePolicy } from '../../../src/travelRule/policy';

const now = new Date('2026-08-27T10:00:00.000Z');

const completeParties = {
  beneficiary: { account: 'beneficiary-wallet', name: 'Beneficiary Person' },
  originator: {
    account: 'originator-wallet',
    address: 'Originator address',
    identifier: 'customer-42',
    name: 'Originator Person',
    verified: true,
  },
};

const valuation = (currency, value) => ({ asOf: '2026-08-27T09:59:00.000Z', currency, source: 'vasp-treasury', value });

const evaluate = overrides =>
  evaluatePolicy({
    asset: { isStablecoin: false },
    counterpartyType: 'hosted',
    description: 'Customer requested withdrawal',
    direction: 'outbound',
    now,
    parties: completeParties,
    profile: 'TR-MASAK-2025',
    riskSignals: [],
    valuations: [valuation('TRY', 10000), valuation('USD', 300)],
    ...overrides,
  });

test('allows a complete Turkish transfer below the enhanced verification threshold', () => {
  const result = evaluate();

  expect(result).toMatchObject({
    action: 'allow',
    approval: 'none',
    profile: 'TR-MASAK-2025',
    reasonCodes: [],
    retentionProfile: 'TR-5Y',
  });
  expect(result.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
});

test('holds a Turkish transfer at the 15000 TRY boundary when verified originator detail is missing', () => {
  const result = evaluate({
    parties: { ...completeParties, originator: { account: 'originator-wallet', name: 'Originator Person', verified: false } },
    valuations: [valuation('TRY', 15000), valuation('USD', 450)],
  });

  expect(result).toMatchObject({
    action: 'hold',
    approval: 'compliance_reviewer',
    reasonCodes: ['ORIGINATOR_VERIFICATION_REQUIRED'],
  });
  expect(result.requiredFields).toEqual(expect.arrayContaining(['originator.identifier', 'originator.verified']));
});

test('applies the doubled Turkish stablecoin daily limit only when Travel Rule data was exchanged', () => {
  const allowed = evaluate({
    asset: { isStablecoin: true },
    linkedTotals: { dailyUsd: 5900, monthlyUsd: 5900 },
    travelRuleApplied: true,
    valuations: [valuation('TRY', 3000), valuation('USD', 100)],
  });
  const held = evaluate({
    asset: { isStablecoin: true },
    linkedTotals: { dailyUsd: 5900, monthlyUsd: 5900 },
    travelRuleApplied: false,
    valuations: [valuation('TRY', 3000), valuation('USD', 100)],
  });

  expect(allowed.action).toBe('allow');
  expect(held).toMatchObject({ action: 'hold', reasonCodes: ['STABLECOIN_LIMIT_EXCEEDED'] });
});

test('holds a first Turkish withdrawal to an unhosted wallet for 72 hours', () => {
  const result = evaluate({
    assetAcquiredAt: '2026-08-25T10:00:00.000Z',
    counterpartyType: 'unhosted',
    firstWithdrawal: true,
    walletEvidence: { declaration: true, ownerName: 'Beneficiary Person' },
  });

  expect(result).toMatchObject({
    action: 'hold',
    reasonCodes: ['WAITING_PERIOD_ACTIVE'],
    waitUntil: '2026-08-28T10:00:00.000Z',
  });
});

test('requires complete EU Travel Rule fields even below 1000 EUR', () => {
  const result = evaluate({
    parties: { ...completeParties, originator: { account: 'originator-wallet', name: 'Originator Person', verified: true } },
    profile: 'EU-TFR-2024',
    valuations: [valuation('EUR', 10)],
  });

  expect(result).toMatchObject({ action: 'hold', reasonCodes: ['REQUIRED_DATA_MISSING'], retentionProfile: 'EU-5Y' });
  expect(result.requiredFields).toContain('originator.address_or_identifier');
});

test('requires ownership or control evidence only above 1000 EUR for an EU self-hosted wallet', () => {
  const boundary = evaluate({
    counterpartyType: 'unhosted',
    profile: 'EU-TFR-2024',
    valuations: [valuation('EUR', 1000)],
  });
  const aboveBoundary = evaluate({
    counterpartyType: 'unhosted',
    profile: 'EU-TFR-2024',
    valuations: [valuation('EUR', 1000.01)],
  });

  expect(boundary.action).toBe('allow');
  expect(aboveBoundary).toMatchObject({ action: 'manual_review', approval: 'compliance_approver', reasonCodes: ['WALLET_OWNERSHIP_ASSESSMENT_REQUIRED'] });
});

test('rejects a sanctions match before lower-severity policy outcomes', () => {
  const result = evaluate({
    parties: {},
    riskSignals: [{ matched: true, type: 'sanctions' }],
  });

  expect(result).toMatchObject({ action: 'reject', approval: 'compliance_approver', reasonCodes: ['SANCTIONS_MATCH'] });
});

test('produces a deterministic decision snapshot that changes with policy inputs', () => {
  const first = evaluate();
  const repeated = evaluate();
  const changed = evaluate({ direction: 'inbound' });

  expect(repeated.snapshotHash).toBe(first.snapshotHash);
  expect(changed.snapshotHash).not.toBe(first.snapshotHash);
});

test.each([
  ['TR-MASAK-2025', 'TRY'],
  ['EU-TFR-2024', 'EUR'],
])('holds %s decisions without a fresh %s valuation', (profile, currency) => {
  const missing = evaluate({ profile, valuations: [] });
  const stale = evaluate({ profile, valuations: [{ asOf: '2026-08-27T09:54:59.000Z', currency, source: 'vasp-treasury', value: 100 }] });

  expect(missing).toMatchObject({ action: 'hold', reasonCodes: ['VALUATION_REQUIRED'] });
  expect(stale).toMatchObject({ action: 'hold', reasonCodes: ['VALUATION_REQUIRED'] });
  expect(stale.requiredFields).toContain(`valuations.${currency}`);
});

test('requires a fresh USD valuation before applying Turkish stablecoin limits', () => {
  const result = evaluate({
    asset: { isStablecoin: true },
    valuations: [valuation('TRY', 1000)],
  });

  expect(result).toMatchObject({ action: 'hold', reasonCodes: ['VALUATION_REQUIRED'], requiredFields: ['valuations.USD'] });
});
