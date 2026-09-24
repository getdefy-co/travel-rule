import jwt from 'jsonwebtoken';
import { isJwtKeyConfigured } from '../config/jwt';

const getJwtKey = () => {
  const key = process.env.JWT_KEY;

  if (!isJwtKeyConfigured(key)) {
    throw new Error('JWT_KEY environment variable is not configured properly');
  }

  return key;
};

const sign = (payload, options) => {
  return jwt.sign(payload, getJwtKey(), { algorithm: 'HS256', expiresIn: '1d', ...options });
};

const verify = token => {
  try {
    return jwt.verify(token, getJwtKey(), { algorithms: ['HS256'] });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    }

    throw new Error('Invalid token');
  }
};

export default {
  sign,
  verify,
};
