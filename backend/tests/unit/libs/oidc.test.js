import { generateKeyPairSync } from 'node:crypto';
import jsonwebtoken from 'jsonwebtoken';
import { createOidcVerifier } from '../../../src/libs/oidc';

const config = { audience: 'defy-travel-rule', emailClaim: 'email', issuer: 'https://identity.example.test/realms/defy' };

test('verifies an RS256 token from same-origin OIDC discovery and caches its JWKS', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const fetchImpl = jest
    .fn()
    .mockResolvedValueOnce({
      json: jest.fn().mockResolvedValue({ issuer: config.issuer, jwks_uri: 'https://identity.example.test/realms/defy/protocol/openid-connect/certs' }),
      ok: true,
    })
    .mockResolvedValueOnce({ json: jest.fn().mockResolvedValue({ keys: [{ ...jwk, alg: 'RS256', kid: 'signing-key', use: 'sig' }] }), ok: true });
  const token = jsonwebtoken.sign({ email: 'reviewer@example.test' }, privateKey, {
    algorithm: 'RS256',
    audience: config.audience,
    expiresIn: '5m',
    issuer: config.issuer,
    keyid: 'signing-key',
  });
  const verifier = createOidcVerifier({ fetchImpl });

  await expect(verifier.verify({ config, token })).resolves.toEqual({ email: 'reviewer@example.test' });
  await expect(verifier.verify({ config, token })).resolves.toEqual({ email: 'reviewer@example.test' });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

test('rejects algorithm confusion, foreign JWKS origins, and invalid claims generically', async () => {
  const verifier = createOidcVerifier({
    fetchImpl: jest.fn().mockResolvedValue({ json: jest.fn().mockResolvedValue({ issuer: config.issuer, jwks_uri: 'https://attacker.example/jwks' }), ok: true }),
  });
  const hsToken = jsonwebtoken.sign({ email: 'user@example.test' }, 'secret', { algorithm: 'HS256', keyid: 'key' });

  await expect(verifier.verify({ config, token: hsToken })).rejects.toThrow('OIDC verification failed.');

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsToken = jsonwebtoken.sign({ email: 'user@example.test' }, privateKey, { algorithm: 'RS256', keyid: 'key' });
  await expect(verifier.verify({ config, token: rsToken })).rejects.toThrow('OIDC verification failed.');
});

test.each(['discovery', 'jwks', 'empty'])('fails closed for unavailable or empty %s metadata', async stage => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const token = jsonwebtoken.sign({ email: 'user@example.test' }, privateKey, { algorithm: 'RS256', keyid: 'key' });
  const discovery = {
    json: jest.fn().mockResolvedValue({ issuer: config.issuer, jwks_uri: 'https://identity.example.test/realms/defy/jwks' }),
    ok: stage !== 'discovery',
  };
  const jwks = { json: jest.fn().mockResolvedValue({ keys: [] }), ok: stage !== 'jwks' };
  const verifier = createOidcVerifier({ fetchImpl: jest.fn().mockResolvedValueOnce(discovery).mockResolvedValueOnce(jwks) });

  await expect(verifier.verify({ config, token })).rejects.toThrow('OIDC verification failed.');
});

test('rejects an unknown key id and missing email claim after valid discovery', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const discovery = { json: jest.fn().mockResolvedValue({ issuer: config.issuer, jwks_uri: 'https://identity.example.test/realms/defy/jwks' }), ok: true };
  const jwks = { json: jest.fn().mockResolvedValue({ keys: [{ ...jwk, alg: 'RS256', kid: 'known', use: 'sig' }] }), ok: true };
  const verifier = createOidcVerifier({ fetchImpl: jest.fn().mockResolvedValueOnce(discovery).mockResolvedValueOnce(jwks) });
  const unknown = jsonwebtoken.sign({ email: 'user@example.test' }, privateKey, { algorithm: 'RS256', audience: config.audience, issuer: config.issuer, keyid: 'unknown' });

  await expect(verifier.verify({ config, token: unknown })).rejects.toThrow('OIDC verification failed.');

  const missingEmailVerifier = createOidcVerifier({ fetchImpl: jest.fn().mockResolvedValueOnce(discovery).mockResolvedValueOnce(jwks) });
  const missingEmail = jsonwebtoken.sign({ sub: 'user' }, privateKey, { algorithm: 'RS256', audience: config.audience, issuer: config.issuer, keyid: 'known' });

  await expect(missingEmailVerifier.verify({ config, token: missingEmail })).rejects.toThrow('OIDC verification failed.');
});
