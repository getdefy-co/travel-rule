import { authDB, pool } from '@database';
import { getServiceApiKey, rotateServiceApiKey } from '../../../travelRule/configuration';

const metadata = apiKey => {
  return { configured: Boolean(apiKey), masked: apiKey ? `${apiKey.slice(0, 4)}${'*'.repeat(8)}${apiKey.slice(-4)}` : null };
};

const get = async (_req, res) => {
  const { apiKey, updatedAt } = getServiceApiKey();
  return res.status(200).json({ ...metadata(apiKey), updated_at: updatedAt });
};

const reveal = async (req, res, next) => {
  try {
    const { apiKey, updatedAt } = getServiceApiKey();
    await authDB.insertActionHistory({ user_id: req.user_id, action: 'revealed_service_api_key', data: { updated_at: updatedAt } });
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ api_key: apiKey, updated_at: updatedAt });
  } catch (error) {
    return next(error);
  }
};

const rotate = async (req, res, next) => {
  try {
    await rotateServiceApiKey(pool, req.body.api_key, req.user_id);
    const { apiKey, updatedAt } = getServiceApiKey();
    return res.status(200).json({ ...metadata(apiKey), updated_at: updatedAt });
  } catch (error) {
    return next(error);
  }
};

const serviceApiKey = (req, res, next) => {
  if (req.method === 'GET') {
    return get(req, res, next);
  }

  if (req.path.endsWith('/reveal')) {
    return reveal(req, res, next);
  }

  return rotate(req, res, next);
};

export default serviceApiKey;
