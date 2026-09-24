import { randomInt } from 'node:crypto';

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const generateAlphanumeric = length => {
  let value = '';

  for (let index = 0; index < length; index += 1) {
    value += ALPHANUMERIC[randomInt(ALPHANUMERIC.length)];
  }

  return value;
};

export default { generateAlphanumeric };
