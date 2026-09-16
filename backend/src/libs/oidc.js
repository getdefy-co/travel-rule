import { createPublicKey } from 'node:crypto';
import jsonwebtoken from 'jsonwebtoken';

const createOidcVerifier = ({
  fetchImpl = fetch,
  now = () => {
    return Date.now();
  },
} = {}) => {
  let cache = null;

  const loadKeys = async config => {
    if (cache?.issuer === config.issuer && cache.expiresAt > now()) {
      return cache.keys;
    }

    try {
      const discoveryUrl = new URL(`${config.issuer}/.well-known/openid-configuration`);
      const discoveryResponse = await fetchImpl(discoveryUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });

      if (!discoveryResponse.ok) {
        throw new Error('Discovery failed.');
      }

      const discovery = await discoveryResponse.json();
      const jwksUrl = new URL(discovery.jwks_uri);

      if (discovery.issuer !== config.issuer || jwksUrl.protocol !== 'https:' || jwksUrl.origin !== discoveryUrl.origin) {
        throw new Error('Discovery metadata is invalid.');
      }

      const jwksResponse = await fetchImpl(jwksUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });

      if (!jwksResponse.ok) {
        throw new Error('JWKS failed.');
      }

      const jwks = await jwksResponse.json();
      const keys = new Map(
        (Array.isArray(jwks.keys) ? jwks.keys : [])
          .filter(key => {
            return key?.kty === 'RSA' && key.use === 'sig' && (!key.alg || key.alg === 'RS256') && typeof key.kid === 'string';
          })
          .map(key => {
            return [key.kid, createPublicKey({ format: 'jwk', key })];
          }),
      );

      if (keys.size === 0) {
        throw new Error('JWKS is empty.');
      }

      cache = { expiresAt: now() + 10 * 60 * 1000, issuer: config.issuer, keys };
      return keys;
    } catch (_error) {
      throw new Error('OIDC verification failed.');
    }
  };

  const verify = async ({ config, token }) => {
    const decoded = jsonwebtoken.decode(token, { complete: true });

    if (decoded?.header?.alg !== 'RS256' || typeof decoded.header.kid !== 'string') {
      throw new Error('OIDC verification failed.');
    }

    const keys = await loadKeys(config);
    const key = keys.get(decoded.header.kid);

    if (!key) {
      cache = null;
      throw new Error('OIDC verification failed.');
    }

    try {
      const claims = jsonwebtoken.verify(token, key, { algorithms: ['RS256'], audience: config.audience, issuer: config.issuer });
      const email = claims[config.emailClaim];

      if (typeof email !== 'string' || !email.trim()) {
        throw new Error('Email claim is missing.');
      }

      return { email };
    } catch (_error) {
      throw new Error('OIDC verification failed.');
    }
  };

  return Object.freeze({ verify });
};

const oidc = createOidcVerifier();

export { createOidcVerifier };
export default oidc;
