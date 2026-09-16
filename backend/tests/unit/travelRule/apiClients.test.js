import { createHash } from 'node:crypto';
import { createApiClientService } from '../../../src/travelRule/apiClients';

const createService = database => {
  const ids = ['client-id', 'credential-id'];

  return createApiClientService({
    database,
    randomBytes: () => Buffer.alloc(32, 7),
    randomId: () => ids.shift(),
  });
};

test('creates a scoped API client and reveals its generated credential exactly once', async () => {
  let captured;
  const database = {
    createClient: jest.fn(input => {
      captured = input;
      return Promise.resolve({ createdAt: '2026-08-27T10:00:00.000Z', id: input.id, name: input.name, scopes: input.scopes, status: 'active' });
    }),
  };
  const service = createService(database);
  const result = await service.createClient({
    actorUserId: 7,
    expiresAt: new Date('2026-09-27T10:00:00.000Z'),
    name: 'custody-adapter',
    scopes: ['transfers:read', 'transfers:write'],
  });

  expect(result).toMatchObject({ id: 'client-id', name: 'custody-adapter', scopes: ['transfers:read', 'transfers:write'], status: 'active' });
  expect(result.api_key).toMatch(/^defy_[A-Za-z0-9_-]{43}$/);
  expect(captured).toMatchObject({ actorUserId: 7, credentialId: 'credential-id', id: 'client-id', name: 'custody-adapter' });
  expect(captured.keyDigest).toEqual(createHash('sha256').update(result.api_key).digest());
});

test('rotates credentials with overlap while returning only the new secret', async () => {
  let captured;
  const database = {
    rotateCredential: jest.fn(input => {
      captured = input;
      return Promise.resolve({ credentialId: input.credentialId, expiresAt: input.expiresAt });
    }),
  };
  const service = createService(database);
  const result = await service.rotateCredential({ actorUserId: 7, clientId: 'client-id', expiresAt: null });

  expect(result.api_key).toMatch(/^defy_/);
  expect(captured).toMatchObject({ actorUserId: 7, clientId: 'client-id', credentialId: 'client-id', expiresAt: null });
  expect(captured.keyDigest).toEqual(createHash('sha256').update(result.api_key).digest());
});

test('rejects unknown scopes before generating or persisting a credential', async () => {
  const database = { createClient: jest.fn() };
  const service = createService(database);

  await expect(service.createClient({ actorUserId: 7, expiresAt: null, name: 'invalid', scopes: ['database:admin'] })).rejects.toThrow('Invalid API client scopes.');
  expect(database.createClient).not.toHaveBeenCalled();
});
