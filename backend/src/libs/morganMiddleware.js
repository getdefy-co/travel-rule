import morgan from 'morgan';
import Logger from './logger';
import { redactRequestUrl } from './requestUrl';

const stream = {
  write: message => {
    return Logger.http(message);
  },
};

const skip = () => {
  const env = process.env.NODE_ENV || 'development';
  return env !== 'development';
};

morgan.token('safe-url', request => {
  return redactRequestUrl(request.originalUrl || request.url);
});

const morganMiddleware = morgan(':method :remote-addr :safe-url :status :res[content-length] - :response-time ms', { stream, skip });

export default morganMiddleware;
