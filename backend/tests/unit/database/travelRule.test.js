const mockClient = { query: jest.fn(), release: jest.fn() };
const mockPool = { connect: jest.fn(() => Promise.resolve(mockClient)), query: jest.fn() };

jest.mock('../../../src/database/postgres', () => ({ pool: mockPool }));

const database = jest.requireActual('../../../src/database/travelRule').default;

const row = { direction: 'inbound', id: 'transfer-id', state: 'pending' };
const transfer = {
  amount: '1',
  assetDti: 'dti',
  direction: 'inbound',
  expiresAt: new Date(),
  id: 'transfer-id',
  operationEncrypted: { value: 'operation' },
  payloadEncrypted: { value: 'payload' },
  retentionUntil: new Date(),
  state: 'pending',
};
const token = { digest: Buffer.alloc(32), expiresAt: new Date(), id: 'token-id', purpose: 'inquiry', transferId: 'transfer-id' };
const message = {
  deliveryState: 'pending',
  direction: 'outbound',
  id: 'message-id',
  logicalIdentifier: 'logical-id',
  phase: 'inquiry',
  requestIdentifier: 'request-id',
  transferId: 'transfer-id',
};

beforeEach(() => {
  mockClient.query.mockReset();
  mockClient.release.mockReset();
  mockPool.connect.mockClear();
  mockPool.query.mockReset();
  mockClient.query.mockResolvedValue({ rowCount: 1, rows: [] });
  mockPool.query.mockResolvedValue({ rowCount: 1, rows: [] });
});

test('creates transfers with and without a token in a transaction', async () => {
  await expect(database.createTransfer({ message, token, transfer })).resolves.toBe('transfer-id');
  expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  expect(mockClient.query.mock.calls.some(([sql]) => sql.includes('travel_rule_messages'))).toBe(true);
  expect(mockClient.release).toHaveBeenCalled();

  mockClient.query.mockClear();
  await database.createTransfer({ transfer: { direction: 'outbound', id: 'minimal', payloadEncrypted: {}, retentionUntil: new Date(), state: 'pending' } });
  expect(mockClient.query.mock.calls.some(([sql]) => sql.includes('travel_rule_tokens'))).toBe(false);
});

test('rolls back and releases a failed transaction', async () => {
  mockClient.query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error('insert failed')).mockResolvedValue({ rows: [] });
  await expect(database.createTransfer({ transfer })).rejects.toThrow('insert failed');
  expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  expect(mockClient.release).toHaveBeenCalled();
});

test('inserts messages and updates delivery', async () => {
  await database.insertMessage({ ...message, errorCode: 'error', peerFingerprint: 'peer', requestEncrypted: {}, responseEncrypted: {}, statusCode: 202 });
  await database.insertMessage(message);
  await database.updateMessageDelivery({ errorCode: 'none', id: 'message-id', responseEncrypted: {}, state: 'delivered', statusCode: 200 });
  expect(mockPool.query).toHaveBeenCalledTimes(3);
});

test('reserves only one active outbound message under a transfer row lock', async () => {
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ direction: 'outbound', state: 'approved' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValue({ rows: [] });
  await expect(database.reserveOutboundMessage({ expectedDirection: 'outbound', expectedStates: ['approved'], message: { ...message, phase: 'confirmation' } })).resolves.toBe(true);
  expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

  mockClient.query.mockReset();
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ direction: 'outbound', state: 'approved' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'active-message' }] })
    .mockResolvedValue({ rows: [] });
  await expect(database.reserveOutboundMessage({ expectedDirection: 'outbound', expectedStates: ['approved'], message: { ...message, phase: 'confirmation' } })).resolves.toBe(false);
});

test('atomically completes outbound delivery with its transfer transition', async () => {
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ delivery_state: 'pending', state: 'pending', superseded_by: null }] })
    .mockResolvedValue({ rows: [] });
  const completed = await database.completeOutboundDelivery({
    id: 'message-id',
    responseEncrypted: {},
    statusCode: 200,
    transition: { eventType: 'approved', expectedStates: ['pending'], operationEncrypted: {}, state: 'approved', transferId: 'transfer-id' },
  });

  expect(completed).toBe(true);
  expect(mockClient.query.mock.calls.some(([sql]) => sql.includes("delivery_state = 'delivered'"))).toBe(true);
  expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
});

test('rolls back both delivery and state when atomic completion fails', async () => {
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ delivery_state: 'pending', state: 'pending', superseded_by: null }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockRejectedValueOnce(new Error('delivery update failed'))
    .mockResolvedValue({ rows: [] });

  await expect(
    database.completeOutboundDelivery({
      id: 'message-id',
      statusCode: 200,
      transition: { eventType: 'approved', expectedStates: ['pending'], operationEncrypted: {}, state: 'approved', transferId: 'transfer-id' },
    }),
  ).rejects.toThrow('delivery update failed');
  expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
});

test('replays an idempotent inbound request before examining token consumption', async () => {
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ response_encrypted: {}, status_code: 200, transfer_id: 'transfer-id' }] })
    .mockResolvedValueOnce({ rows: [] });
  const result = await database.consumeProtocolToken({ peerFingerprint: 'peer', purpose: 'inquiry', requestIdentifier: 'request-id', tokenDigest: Buffer.alloc(32), transition: {} });
  expect(result).toMatchObject({ replay: true, transfer_id: 'transfer-id' });
});

test.each([
  [{ rows: [] }, ['pending']],
  [{ rows: [{ state: 'rejected', token_id: 'token-id', transfer_id: 'transfer-id' }] }, ['pending']],
])('rejects unavailable or state-incompatible protocol tokens', async (tokenResult, allowedStates) => {
  mockClient.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce(tokenResult).mockResolvedValueOnce({ rows: [] });
  const result = await database.consumeProtocolToken({
    peerFingerprint: 'peer',
    purpose: 'inquiry',
    requestIdentifier: 'request-id',
    responseEncrypted: {},
    tokenDigest: Buffer.alloc(32),
    transition: { allowedStates },
  });
  expect(result).toBeNull();
});

test('consumes and conditionally transitions a protocol token', async () => {
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ state: 'pending', token_id: 'token-id', transfer_id: 'transfer-id' }] })
    .mockResolvedValueOnce({ rows: [{ ...row, state: 'approved' }] })
    .mockResolvedValue({ rows: [] });
  const result = await database.consumeProtocolToken({
    peerFingerprint: 'peer',
    purpose: 'resolution',
    requestIdentifier: 'request-id',
    responseEncrypted: {},
    tokenDigest: Buffer.alloc(32),
    transition: {
      allowedStates: ['pending'],
      eventType: 'approved',
      logicalIdentifier: 'logical-id',
      messageId: 'message-id',
      nextState: 'approved',
      operationEncrypted: {},
      requestEncrypted: {},
      statusCode: 204,
    },
  });
  expect(result).toMatchObject({ replay: false, transfer: { state: 'approved' } });
});

test('keeps current state while applying all optional inquiry fields', async () => {
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ state: 'pending', token_id: 'token-id', transfer_id: 'transfer-id' }] })
    .mockResolvedValueOnce({ rows: [row] })
    .mockResolvedValue({ rows: [] });
  await expect(
    database.consumeProtocolToken({
      peerFingerprint: 'peer',
      purpose: 'inquiry',
      requestIdentifier: 'request-id',
      tokenDigest: Buffer.alloc(32),
      transition: { allowedStates: ['pending'], amount: '2', assetDti: 'dti', eventType: 'received', logicalIdentifier: 'logical', messageId: 'message', payloadEncrypted: {} },
    }),
  ).resolves.toMatchObject({ replay: false });
});

test('handles a lost conditional update race as not found', async () => {
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ state: 'pending', token_id: 'token-id', transfer_id: 'transfer-id' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
  const result = await database.consumeProtocolToken({
    peerFingerprint: 'peer',
    purpose: 'inquiry',
    requestIdentifier: 'request-id',
    responseEncrypted: {},
    tokenDigest: Buffer.alloc(32),
    transition: { allowedStates: ['pending'] },
  });
  expect(result).toBeNull();
});

test('rechecks replay after waiting on a concurrently consumed token', async () => {
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ response_encrypted: {}, status_code: 200, transfer_id: 'transfer-id' }] })
    .mockResolvedValueOnce({ rows: [] });
  await expect(
    database.consumeProtocolToken({ peerFingerprint: 'peer', purpose: 'inquiry', requestIdentifier: 'request-id', tokenDigest: Buffer.alloc(32), transition: { allowedStates: ['pending'] } }),
  ).resolves.toMatchObject({ replay: true, transfer_id: 'transfer-id' });
});

test.each([['pending'], [null]])('lists inquiries with optional status %p', async status => {
  mockPool.query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [{ count: '1' }] });
  await expect(database.listInquiries({ limit: 10, offset: 0, status })).resolves.toEqual({ data: [row], total: 1 });
});

test('gets present and absent transfers', async () => {
  mockPool.query.mockResolvedValueOnce({ rows: [row] });
  await expect(database.getTransfer('transfer-id')).resolves.toEqual(row);
  mockPool.query.mockResolvedValueOnce({ rows: [] });
  await expect(database.getTransfer('missing')).resolves.toBeNull();

  mockPool.query.mockResolvedValueOnce({ rows: [row] });
  await expect(database.getTransferByTokenDigest({ digest: Buffer.alloc(32), purpose: 'confirmation' })).resolves.toEqual(row);
  mockPool.query.mockResolvedValueOnce({ rows: [] });
  await expect(database.getTransferByTokenDigest({ digest: Buffer.alloc(32), purpose: 'confirmation' })).resolves.toBeNull();
});

test('decides an inquiry and optionally creates a confirmation token', async () => {
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [row] })
    .mockResolvedValue({ rows: [] });
  const result = await database.decideInquiry({
    actor: { emailEncrypted: { ciphertext: 'encrypted' }, role: 'user', userId: 7 },
    eventType: 'manual_approval',
    expectedState: 'pending',
    id: 'transfer-id',
    message,
    nextState: 'approved',
    operationEncrypted: {},
    token,
  });
  expect(result).toEqual(row);

  mockClient.query.mockReset();
  mockClient.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
  await expect(database.decideInquiry({ actor: {}, expectedState: 'pending', id: 'missing', nextState: 'rejected' })).resolves.toBeNull();

  mockClient.query.mockReset();
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [row] })
    .mockResolvedValue({ rows: [] });
  await expect(
    database.decideInquiry({
      actor: { emailEncrypted: { ciphertext: 'encrypted' }, role: 'admin', userId: 8 },
      eventType: 'manual_rejection',
      expectedState: 'pending',
      id: 'transfer-id',
      nextState: 'rejected',
      operationEncrypted: {},
    }),
  ).resolves.toEqual(row);
});

test('gets retryable messages and supersedes one atomically', async () => {
  mockPool.query.mockResolvedValueOnce({ rows: [message] });
  await expect(database.getRetryableMessage('transfer-id')).resolves.toEqual(message);
  mockPool.query.mockResolvedValueOnce({ rows: [] });
  await expect(database.getRetryableMessage('missing')).resolves.toBeNull();
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'previous-id' }] })
    .mockResolvedValue({ rows: [] });
  await expect(database.supersedeMessage({ message, previousId: 'previous-id' })).resolves.toBe(true);
  expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

  mockClient.query.mockReset();
  mockClient.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
  await expect(database.supersedeMessage({ message, previousId: 'already-superseded' })).resolves.toBe(false);
});

test('uses an advisory lock for cleanup', async () => {
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ acquired: false }] })
    .mockResolvedValueOnce({ rows: [] });
  await expect(database.cleanupExpired(1825)).resolves.toBe(0);

  mockClient.query.mockReset();
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ acquired: true }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: 'one' }, { id: 'two' }] })
    .mockResolvedValueOnce({ rows: [] });
  await expect(database.cleanupExpired(1825)).resolves.toBe(2);
  expect(mockClient.query.mock.calls.some(([sql]) => sql.includes("'transfer_expired'"))).toBe(true);
});

test('lists and retrieves safe management projections', async () => {
  mockPool.query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [{ count: '1' }] });
  await expect(
    database.listManagementResources({
      filters: { direction: 'inbound', search: 'outside-page-one', state: 'pending' },
      resource: 'transfers',
      page: 2,
      limit: 10,
    }),
  ).resolves.toEqual({ data: [row], total: 1, page: 2, limit: 10 });
  expect(mockPool.query.mock.calls[0][0]).toMatch(/strpos\(lower\(id::text\), lower\(\$1\)\)/);
  expect(mockPool.query.mock.calls[0][0]).toMatch(/direction = \$2/);
  expect(mockPool.query.mock.calls[0][0]).toMatch(/state = \$3/);
  expect(mockPool.query.mock.calls[0][1]).toEqual(['outside-page-one', 'inbound', 'pending', 10, 10]);
  expect(mockPool.query.mock.calls[1][0]).toMatch(/WHERE/);
  expect(mockPool.query.mock.calls[1][1]).toEqual(['outside-page-one', 'inbound', 'pending']);
  expect(mockPool.query.mock.calls[0][0]).not.toMatch(/payload_encrypted|operation_encrypted/);

  const messageDetail = { ...message, actions: { can_retry: true } };
  mockPool.query.mockResolvedValueOnce({ rows: [messageDetail] });
  await expect(database.getManagementResource({ resource: 'messages', id: 'message-id', retryBefore: new Date('2026-08-26T00:00:00.000Z') })).resolves.toEqual(messageDetail);
  expect(mockPool.query.mock.calls[2][0]).not.toMatch(/peer_fingerprint|request_encrypted|response_encrypted/);
  expect(mockPool.query.mock.calls[2][0]).toMatch(/delivery_state = 'failed'/);

  const transferDetail = { ...row, actions: { can_cancel: true, can_confirm: true, can_retry: false } };
  const event = { id: '9223372036854775807', transfer_id: 'transfer-id', event_type: 'inquiry_received' };
  mockPool.query.mockResolvedValueOnce({ rows: [transferDetail] }).mockResolvedValueOnce({ rows: [event] });
  const detailRequest = { resource: 'transfers', id: 'transfer-id', retryBefore: new Date('2026-08-26T00:00:00.000Z') };
  await expect(database.getManagementResource(detailRequest)).resolves.toEqual({ ...transferDetail, events: [event] });
  expect(mockPool.query.mock.calls[3][0]).toMatch(/direction = 'outbound'.*state = 'approved'/s);
  expect(mockPool.query.mock.calls[3][0]).toMatch(/phase = 'confirmation'/);
  expect(mockPool.query.mock.calls[3][0]).toMatch(/created_at <= \$2/);
  expect(mockPool.query.mock.calls[4][0]).toMatch(/ORDER BY created_at ASC, id ASC/);

  mockPool.query.mockResolvedValueOnce({ rows: [] });
  await expect(database.getManagementResource({ resource: 'tokens', id: 'missing' })).resolves.toBeNull();
  await expect(database.listManagementResources({ resource: 'unknown', page: 1, limit: 10 })).rejects.toThrow('Invalid management resource.');
  await expect(database.getManagementResource({ resource: 'unknown', id: 'id' })).rejects.toThrow('Invalid management resource.');
});

test('lists unfiltered transfer resources with matching pagination and total queries', async () => {
  mockPool.query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [{ count: '1' }] });

  await expect(database.listManagementResources({ resource: 'transfers', page: 1, limit: 20 })).resolves.toEqual({ data: [row], total: 1, page: 1, limit: 20 });

  expect(mockPool.query.mock.calls[0][0]).not.toMatch(/ WHERE /);
  expect(mockPool.query.mock.calls[0][1]).toEqual([20, 0]);
  expect(mockPool.query.mock.calls[1][0]).not.toMatch(/ WHERE /);
  expect(mockPool.query.mock.calls[1][1]).toEqual([]);
});

test('searches inbound inquiries with identical count predicates and literal parameters', async () => {
  mockPool.query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [{ count: '1' }] });
  await expect(database.listInquiries({ status: 'pending', search: "asset%_'", limit: 10, offset: 20 })).resolves.toEqual({ data: [row], total: 1 });

  const [query, values] = mockPool.query.mock.calls[0];
  const [countQuery, countValues] = mockPool.query.mock.calls[1];
  expect(values).toEqual(['inbound', 'pending', "asset%_'", 10, 20]);
  expect(countValues).toEqual(['inbound', 'pending', "asset%_'"]);
  expect(query).toContain('strpos(');
  expect(query).toContain('asset_dti');
  expect(query).not.toContain("asset%_'");
  expect(countQuery.split(' WHERE ')[1]).toBe(query.split(' WHERE ')[1].split(' ORDER BY ')[0].trim());
});

test.each([
  [
    'messages',
    { search: 'request%', direction: 'inbound', phase: 'inquiry', delivery_state: 'received' },
    ['request%', 'inbound', 'inquiry', 'received'],
    ['logical_identifier', 'request_identifier', 'status_code', 'error_code'],
  ],
  ['tokens', { search: 'transfer_', purpose: 'resolution', status: 'consumed' }, ['transfer_', 'resolution'], ['transfer_id', 'consumed_at IS NOT NULL']],
  [
    'events',
    { search: '9223372036854775807', event_type: 'manual_approval', from_state: 'pending', to_state: 'approved' },
    ['9223372036854775807', 'manual_approval', 'pending', 'approved'],
    ['actor_user_id', 'actor_role'],
  ],
])('combines %s search and filters before pagination', async (resource, filters, expectedValues, expressions) => {
  mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
  await expect(database.listManagementResources({ resource, filters, page: 3, limit: 10 })).resolves.toEqual({ data: [], total: 0, page: 3, limit: 10 });

  const [query, values] = mockPool.query.mock.calls[0];
  const [countQuery, countValues] = mockPool.query.mock.calls[1];
  expect(values).toEqual([...expectedValues, 10, 20]);
  expect(countValues).toEqual(expectedValues);
  expect(query).toContain('strpos(');
  expressions.forEach(expression => expect(query).toContain(expression));
  expect(countQuery.split(' WHERE ')[1]).toBe(query.split(' WHERE ')[1].split(' ORDER BY ')[0]);
  expect(query).not.toMatch(/token_digest|request_encrypted|metadata/);
});

test.each([
  ['active', '>'],
  ['expired', '<='],
])('uses one timestamp for %s token rows and total', async (status, comparison) => {
  mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ count: '0' }] });
  await database.listManagementResources({ resource: 'tokens', filters: { status }, page: 1, limit: 20 });

  const [query, values] = mockPool.query.mock.calls[0];
  const [countQuery, countValues] = mockPool.query.mock.calls[1];
  expect(query).toContain('consumed_at IS NULL');
  expect(query).toContain(`expires_at ${comparison} $1`);
  expect(countQuery).toContain(`expires_at ${comparison} $1`);
  expect(values[0]).toBeInstanceOf(Date);
  expect(countValues[0]).toBe(values[0]);
});

test('lists unfiltered non-transfer resources without transfer-only predicates', async () => {
  const tokenRow = { created_at: new Date('2026-08-26T00:00:00.000Z'), id: 'token-id', purpose: 'inquiry', transfer_id: 'transfer-id' };
  mockPool.query.mockResolvedValueOnce({ rows: [tokenRow] }).mockResolvedValueOnce({ rows: [{ count: '1' }] });

  await expect(database.listManagementResources({ resource: 'tokens', page: 2, limit: 10 })).resolves.toEqual({ data: [tokenRow], total: 1, page: 2, limit: 10 });

  expect(mockPool.query.mock.calls[0][0]).not.toMatch(/ WHERE /);
  expect(mockPool.query.mock.calls[0][1]).toEqual([10, 10]);
  expect(mockPool.query.mock.calls[1][1]).toEqual([]);
});

test('returns null when a transfer management detail no longer exists', async () => {
  mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ event_type: 'created', id: '1' }] });

  await expect(database.getManagementResource({ resource: 'transfers', id: 'missing-transfer', retryBefore: new Date('2026-08-26T00:00:00.000Z') })).resolves.toBeNull();
});

test('returns zero-filled management analytics query results', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-01-08T12:34:56.000Z'));
  mockPool.query
    .mockResolvedValueOnce({ rows: [{ count: 0, day: '2026-01-01', direction: 'inbound' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ amount: '100', asset_dti: 'dti', id: 'transfer-id' }] })
    .mockResolvedValueOnce({ rows: [{ confirmed_rate: 0, delivery_rate: 0, pending_inquiries: 3, transfers: 0 }] });
  await expect(database.getManagementAnalytics(7)).resolves.toEqual({
    asset_amounts: [{ amount: '100', asset_dti: 'dti', id: 'transfer-id' }],
    summary: { confirmed_rate: 0, delivery_rate: 0, pending_inquiries: 3, transfers: 0 },
    range_days: 7,
    trends: [{ count: 0, day: '2026-01-01', direction: 'inbound' }],
    transfer_states: [],
    message_states: [],
  });
  expect(mockPool.query.mock.calls[0][0]).toMatch(/generate_series/);
  expect(mockPool.query.mock.calls[3][0]).not.toMatch(/SUM\s*\(/i);
  expect(mockPool.query.mock.calls[4][0]).toMatch(/NULLIF/);
  expect(mockPool.query.mock.calls[4][0]).toMatch(/direction = 'inbound' AND state = 'pending'/);
  mockPool.query.mock.calls.forEach(([sql, values]) => {
    expect(sql).not.toMatch(/CURRENT_DATE/);
    expect(values).toEqual([new Date('2026-01-02T00:00:00.000Z'), new Date('2026-01-09T00:00:00.000Z')]);
  });
  expect(mockPool.query.mock.calls[0][0]).toMatch(/AT TIME ZONE 'UTC'/);
  expect(mockPool.query.mock.calls[0][0]).toMatch(/\$1::timestamptz AT TIME ZONE 'UTC'/);
  expect(mockPool.query.mock.calls[0][0]).toMatch(/tr\.created_at >= day AT TIME ZONE 'UTC'/);
  jest.useRealTimers();
});
