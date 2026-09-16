import { createHash, timingSafeEqual } from 'node:crypto';
import validator from 'validator';
import { apiClientDB, authDB } from '@database';
import { jwt } from '@libs';
import oidc from '@libs/oidc';
import { enums } from '@json';
import { authenticateServiceApiKey, isValidServiceApiKey } from '../travelRule/configuration';

const authenticationFailed = res => {
  return res.status(401).json({ message: 'Authentication failed.' });
};

const API_CLIENT_SCOPES = new Set(['transfers:read', 'transfers:write', 'webhooks:manage']);

const isPlainObject = value => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const hasOnlyKeys = (value, allowed) => {
  return Object.keys(value).every(key => {
    return allowed.has(key);
  });
};

const parseCookies = header => {
  if (typeof header !== 'string') {
    return {};
  }

  return header.split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');

    if (separator <= 0) {
      return cookies;
    }

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (name && !Object.prototype.hasOwnProperty.call(cookies, name)) {
      let decodedValue;

      try {
        decodedValue = decodeURIComponent(value);
      } catch (_error) {
        decodedValue = '';
      }

      return { ...cookies, [name]: decodedValue };
    }

    return cookies;
  }, {});
};

const isAuthenticatedWithToken = async (req, res, next) => {
  try {
    const authorization = req?.headers?.authorization;
    const sessionCookie = parseCookies(req?.headers?.cookie).defy_session;

    if (!authorization && !sessionCookie) {
      return res.status(401).json({ message: 'Token is required.' });
    }

    if (authorization && (typeof authorization !== 'string' || !authorization.startsWith('Bearer '))) {
      return res.status(401).json({ message: 'Invalid token.' });
    }

    const token = authorization ? authorization.slice('Bearer '.length) : sessionCookie;
    let verifiedToken;
    let oidcAuthentication = false;

    try {
      verifiedToken = token ? jwt.verify(token) : null;
    } catch (error) {
      if (!authorization || !req.app?.locals?.oidc) {
        throw error;
      }

      verifiedToken = await oidc.verify({ config: req.app.locals.oidc, token });
      oidcAuthentication = true;
    }

    if (!verifiedToken?.email) {
      return res.status(401).json({ message: 'Invalid token.' });
    }

    const user = await authDB.getUser(verifiedToken.email);

    if (!user?.is_active || (!oidcAuthentication && verifiedToken.session_version !== user.session_version)) {
      return authenticationFailed(res);
    }

    req.email = user.email || verifiedToken.email;
    req.auth_source = oidcAuthentication ? 'oidc_bearer' : authorization ? 'bearer' : 'cookie';
    req.user_id = user.id;
    req.user_role = user.role;
    req.token = token;

    return next();
  } catch (error) {
    return authenticationFailed(res);
  }
};

const isCsrfProtected = (req, res, next) => {
  if (req.auth_source !== 'cookie') {
    return next();
  }

  const cookieToken = parseCookies(req?.headers?.cookie).defy_csrf;
  const headerToken = req?.headers?.['x-csrf-token'];
  const validTypes = typeof cookieToken === 'string' && cookieToken.length >= 32 && typeof headerToken === 'string' && headerToken.length >= 32;
  const cookieDigest = createHash('sha256')
    .update(validTypes ? cookieToken : '')
    .digest();
  const headerDigest = createHash('sha256')
    .update(validTypes ? headerToken : 'invalid')
    .digest();

  if (!validTypes || !timingSafeEqual(cookieDigest, headerDigest)) {
    return res.status(403).json({ message: 'CSRF validation failed.' });
  }

  return next();
};

const LEGACY_API_CLIENT = Object.freeze({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'legacy-service-api-key',
  scopes: Object.freeze(['transfers:read', 'transfers:write', 'webhooks:manage']),
});

const isAuthenticatedWithServiceApiKey = async (req, res, next) => {
  try {
    const providedKey = req?.headers?.['x-api-key'];
    const apiClient = await apiClientDB.authenticate(providedKey);

    if (apiClient) {
      req.api_client = apiClient;
      return next();
    }

    if (!authenticateServiceApiKey(providedKey)) {
      return authenticationFailed(res);
    }

    req.api_client = LEGACY_API_CLIENT;
    return next();
  } catch (error) {
    return authenticationFailed(res);
  }
};

const hasTransferWriteScope = (req, res, next) => {
  if (!req.api_client?.scopes?.includes('transfers:write')) {
    return res.status(403).json({ message: 'Access denied.' });
  }

  return next();
};

const hasTransferReadScope = (req, res, next) => {
  if (!req.api_client?.scopes?.includes('transfers:read')) {
    return res.status(403).json({ message: 'Access denied.' });
  }

  return next();
};

const hasWebhookManageScope = (req, res, next) => {
  if (!req.api_client?.scopes?.includes('webhooks:manage')) {
    return res.status(403).json({ message: 'Access denied.' });
  }

  return next();
};

const isAdmin = (req, res, next) => {
  if (![enums.USER_ROLES.ADMIN, enums.USER_ROLES.PLATFORM_ADMIN].includes(req.user_role)) {
    return res.status(403).json({ message: 'Access denied.' });
  }

  return next();
};

const validateServiceApiKey = (req, res, next) => {
  const apiKey = req.body?.api_key;

  if (!isValidServiceApiKey(apiKey)) {
    return res.status(400).json({ message: 'api_key must be 32-256 printable ASCII characters.' });
  }

  return next();
};

const isValidCredentialExpiry = value => {
  if (value === null || value === undefined) {
    return true;
  }

  return typeof value === 'string' && validator.isISO8601(value, { strict: true, strictSeparator: true }) && new Date(value).getTime() > Date.now();
};

const validateApiClientCreate = (req, res, next) => {
  const payload = req.body;
  const valid =
    isPlainObject(payload) &&
    hasOnlyKeys(payload, new Set(['expires_at', 'name', 'scopes'])) &&
    typeof payload.name === 'string' &&
    /^[a-z0-9][a-z0-9._-]{2,63}$/.test(payload.name) &&
    Array.isArray(payload.scopes) &&
    payload.scopes.length >= 1 &&
    payload.scopes.length <= API_CLIENT_SCOPES.size &&
    new Set(payload.scopes).size === payload.scopes.length &&
    payload.scopes.every(scope => {
      return API_CLIENT_SCOPES.has(scope);
    }) &&
    isValidCredentialExpiry(payload.expires_at);

  if (!valid) {
    return res.status(400).json({ message: 'Invalid API client payload.' });
  }

  return next();
};

const validateApiClientRotation = (req, res, next) => {
  const payload = req.body;

  if (!isPlainObject(payload) || !hasOnlyKeys(payload, new Set(['expires_at'])) || !isValidCredentialExpiry(payload.expires_at)) {
    return res.status(400).json({ message: 'Invalid API client credential payload.' });
  }

  return next();
};

const validateApiClientIdentifiers = (req, res, next) => {
  const { clientId, credentialId } = req.params || {};

  if (typeof clientId !== 'string' || !validator.isUUID(clientId) || (credentialId !== undefined && (typeof credentialId !== 'string' || !validator.isUUID(credentialId)))) {
    return res.status(400).json({ message: 'Invalid identifier.' });
  }

  return next();
};

const isValidPasswordLength = password => {
  if (typeof password !== 'string') {
    return false;
  }

  const byteLength = Buffer.byteLength(password, 'utf8');
  return byteLength >= 8 && byteLength <= 72;
};

const login = (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({ message: 'Invalid email.' });
    }

    if (!password) {
      return res.status(400).json({ message: 'Password is required.' });
    }

    if (!isValidPasswordLength(password)) {
      return res.status(400).json({ message: 'Password must be between 8 and 72 bytes.' });
    }

    return next();
  } catch (error) {
    return res.status(400).json({ message: 'Unknown error. Please try again later.' });
  }
};

const updatePassword = (req, res, next) => {
  try {
    const { old_password, new_password } = req.body;

    if (!old_password) {
      return res.status(400).json({ message: 'Old password is required.' });
    }

    if (!new_password) {
      return res.status(400).json({ message: 'New password is required.' });
    }

    if (!isValidPasswordLength(old_password)) {
      return res.status(400).json({ message: 'Old password must be between 8 and 72 bytes.' });
    }

    if (new_password === old_password) {
      return res.status(400).json({ message: 'New password cannot be the same as the old password.' });
    }

    if (!isValidPasswordLength(new_password)) {
      return res.status(400).json({ message: 'New password must be between 8 and 72 bytes.' });
    }

    return next();
  } catch (error) {
    return res.status(400).json({ message: 'Unknown error. Please try again later.' });
  }
};

const validateEmail = (email, res) => {
  if (!email) {
    return res.status(400).json({ message: 'Email is required.' });
  }

  if (!validator.isEmail(email)) {
    return res.status(400).json({ message: 'Invalid email.' });
  }

  return null;
};

const validateRole = (role, res) => {
  if (role && !Object.values(enums.USER_ROLES).includes(role)) {
    return res.status(400).json({ message: 'Invalid role.' });
  }

  return null;
};

const createUser = (req, res, next) => {
  try {
    const emailError = validateEmail(req.body.email, res);

    if (emailError) {
      return emailError;
    }

    const roleError = validateRole(req.body.role, res);

    if (roleError) {
      return roleError;
    }

    return next();
  } catch (error) {
    return res.status(400).json({ message: 'Unknown error. Please try again later.' });
  }
};

const listUsers = (req, res, next) => {
  return next();
};
const me = (req, res, next) => {
  return next();
};

const deactivateUser = async (req, res, next) => {
  try {
    const { email } = req.body;
    const emailError = validateEmail(email, res);

    if (emailError) {
      return emailError;
    }

    const targetUser = await authDB.getUser(email);

    if (!targetUser) {
      return res.status(400).json({ message: 'User not found.' });
    }

    if (!targetUser.is_active) {
      return res.status(400).json({ message: 'User is already deactivated.' });
    }

    return next();
  } catch (error) {
    return res.status(400).json({ message: 'Unknown error. Please try again later.' });
  }
};

const activateUser = async (req, res, next) => {
  try {
    const { email } = req.body;
    const emailError = validateEmail(email, res);

    if (emailError) {
      return emailError;
    }

    const targetUser = await authDB.getUser(email);

    if (!targetUser) {
      return res.status(400).json({ message: 'User not found.' });
    }

    if (targetUser.is_active) {
      return res.status(400).json({ message: 'User is already activated.' });
    }

    return next();
  } catch (error) {
    return res.status(400).json({ message: 'Unknown error. Please try again later.' });
  }
};

const editUser = async (req, res, next) => {
  try {
    const { email, role } = req.body;
    const emailError = validateEmail(email, res);

    if (emailError) {
      return emailError;
    }

    const roleError = validateRole(role, res);

    if (roleError) {
      return roleError;
    }

    const targetUser = await authDB.getUser(email);

    if (!targetUser) {
      return res.status(400).json({ message: 'User not found.' });
    }

    return next();
  } catch (error) {
    return res.status(400).json({ message: 'Unknown error. Please try again later.' });
  }
};

const forgotPassword = (req, res, next) => {
  try {
    const { email } = req.body;
    const emailError = validateEmail(email, res);

    if (emailError) {
      return emailError;
    }

    return next();
  } catch (error) {
    return res.status(400).json({ message: 'Unknown error. Please try again later.' });
  }
};

const resetPassword = (req, res, next) => {
  try {
    const { token, password } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Token is required.' });
    }

    if (!validator.isLength(token, { min: 32, max: 32 })) {
      return res.status(400).json({ message: 'Invalid token.' });
    }

    if (!password) {
      return res.status(400).json({ message: 'Password is required.' });
    }

    if (!isValidPasswordLength(password)) {
      return res.status(400).json({ message: 'Password must be between 8 and 72 bytes.' });
    }

    return next();
  } catch (error) {
    return res.status(400).json({ message: 'Unknown error. Please try again later.' });
  }
};

export default {
  activateUser,
  createUser,
  deactivateUser,
  editUser,
  forgotPassword,
  hasTransferWriteScope,
  hasTransferReadScope,
  hasWebhookManageScope,
  isAdmin,
  isCsrfProtected,
  isAuthenticatedWithServiceApiKey,
  isAuthenticatedWithToken,
  listUsers,
  login,
  me,
  resetPassword,
  updatePassword,
  validateServiceApiKey,
  validateApiClientCreate,
  validateApiClientIdentifiers,
  validateApiClientRotation,
};
