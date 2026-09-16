import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { apiClientDB } from '@database';

const API_CLIENT_SCOPES = new Set(['transfers:read', 'transfers:write', 'webhooks:manage']);

const createApiClientService = ({ database, randomBytes: generateBytes = randomBytes, randomId = randomUUID }) => {
  const assertScopes = scopes => {
    if (
      !Array.isArray(scopes) ||
      scopes.length < 1 ||
      scopes.length > API_CLIENT_SCOPES.size ||
      new Set(scopes).size !== scopes.length ||
      scopes.some(scope => {
        return !API_CLIENT_SCOPES.has(scope);
      })
    ) {
      throw new Error('Invalid API client scopes.');
    }
  };

  const generateCredential = () => {
    const apiKey = `defy_${generateBytes(32).toString('base64url')}`;

    return { apiKey, keyDigest: createHash('sha256').update(apiKey).digest() };
  };

  const createClient = async ({ actorUserId, expiresAt, name, scopes }) => {
    assertScopes(scopes);
    const credential = generateCredential();
    const clientId = randomId();
    const credentialId = randomId();
    const client = await database.createClient({
      actorUserId,
      credentialId,
      expiresAt,
      id: clientId,
      keyDigest: credential.keyDigest,
      name,
      scopes,
    });

    return { ...client, api_key: credential.apiKey };
  };

  const rotateCredential = async ({ actorUserId, clientId, expiresAt }) => {
    const credential = generateCredential();
    const result = await database.rotateCredential({
      actorUserId,
      clientId,
      credentialId: randomId(),
      expiresAt,
      keyDigest: credential.keyDigest,
    });

    return result ? { ...result, api_key: credential.apiKey } : null;
  };

  const listClients = () => {
    return database.listClients();
  };

  const revokeCredential = ({ actorUserId, clientId, credentialId }) => {
    return database.revokeCredential({ actorUserId, clientId, credentialId });
  };

  return Object.freeze({ createClient, listClients, revokeCredential, rotateCredential });
};

const apiClientService = createApiClientService({ database: apiClientDB });

export { API_CLIENT_SCOPES, apiClientService, createApiClientService };
