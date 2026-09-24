import { createHash } from 'node:crypto';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const alphabetIndex = new Map(
  [...alphabet].map((character, index) => {
    return [character, index];
  }),
);

const checksum = payload => {
  const first = createHash('sha256').update(payload).digest();
  return createHash('sha256').update(first).digest().subarray(0, 4);
};

const encodeBase58 = buffer => {
  let value = BigInt(`0x${buffer.toString('hex') || '0'}`);
  let encoded = '';

  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = alphabet[remainder] + encoded;
    value /= 58n;
  }

  const leadingZeroes = buffer.findIndex(byte => {
    return byte !== 0;
  });
  const count = leadingZeroes === -1 ? buffer.length : leadingZeroes;
  return `${'1'.repeat(count)}${encoded}`;
};

const decodeBase58 = value => {
  let decoded = 0n;

  [...value].forEach(character => {
    const index = alphabetIndex.get(character);

    if (index === undefined) {
      throw new Error('Invalid Travel Address encoding.');
    }

    decoded = decoded * 58n + BigInt(index);
  });

  let hex = decoded.toString(16);

  if (hex.length % 2) {
    hex = `0${hex}`;
  }

  const body = decoded === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  const leadingZeroes = value.match(/^1*/)[0].length;
  return Buffer.concat([Buffer.alloc(leadingZeroes), body]);
};

const validatePlainAddress = value => {
  if (typeof value !== 'string' || !value || value.includes('://')) {
    throw new Error('Invalid Travel Address URL.');
  }

  let url;

  try {
    url = new URL(`https://${value}`);
  } catch (error) {
    throw new Error('Invalid Travel Address URL.');
  }

  if (url.username || url.password || url.hash || !url.hostname.includes('.') || url.searchParams.get('t') !== 'i') {
    throw new Error('Invalid Travel Address URL.');
  }

  return value;
};

const encodeTravelAddress = value => {
  const payload = Buffer.from(validatePlainAddress(value), 'utf8');
  return `ta${encodeBase58(Buffer.concat([payload, checksum(payload)]))}`;
};

const decodeTravelAddress = value => {
  try {
    if (typeof value !== 'string' || !value.startsWith('ta')) {
      throw new Error('Invalid prefix.');
    }

    const decoded = decodeBase58(value.slice(2));

    if (decoded.length <= 4) {
      throw new Error('Invalid length.');
    }

    const payload = decoded.subarray(0, -4);
    const suppliedChecksum = decoded.subarray(-4);

    if (!checksum(payload).equals(suppliedChecksum)) {
      throw new Error('Invalid checksum.');
    }

    return validatePlainAddress(payload.toString('utf8'));
  } catch (error) {
    throw new Error('Invalid Travel Address.');
  }
};

export { decodeTravelAddress, encodeTravelAddress };
