import logger from '../libs/logger';
import { redactRequestUrl } from '../libs/requestUrl';
import sanitizer from '../libs/sanitizer';
import { pool } from './postgres';

const writeError = async ({ name, message, status, url = '', details = {} }) => {
  try {
    const sanitizedDetails = sanitizer.sanitizeData(details);
    const sanitizedMessage = sanitizer.maskValue(message);
    const sanitizedUrl = redactRequestUrl(url);
    await pool.query('INSERT INTO error_logs (function_name, message, status, url, details) VALUES ($1, $2, $3, $4, $5)', [name, sanitizedMessage, status, sanitizedUrl, sanitizedDetails]);
    logger.error(`${name} - Error recorded.`);
    return true;
  } catch (_error) {
    logger.error(`${name} - Error persistence failed.`);
    return false;
  }
};

export default { writeError };
