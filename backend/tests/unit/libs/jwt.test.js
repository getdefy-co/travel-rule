import jsonwebtoken from 'jsonwebtoken';
import jwt from '../../../src/libs/jwt';

describe('jwt', () => {
  const originalKey = process.env.JWT_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.JWT_KEY;
    } else {
      process.env.JWT_KEY = originalKey;
    }
  });

  test('signs and verifies HS256 tokens with the configured key', () => {
    process.env.JWT_KEY = 'a-secure-test-key';
    const token = jwt.sign({ sub: 'user-1' }, { expiresIn: '2h' });
    expect(jwt.verify(token)).toMatchObject({ sub: 'user-1' });
    expect(jsonwebtoken.decode(token).exp - jsonwebtoken.decode(token).iat).toBe(7200);
  });

  test.each([undefined, '', 'change-me', ' change-me '])('rejects an unsafe JWT key value', key => {
    if (key === undefined) {
      delete process.env.JWT_KEY;
    } else {
      process.env.JWT_KEY = key;
    }

    expect(() => jwt.sign({ sub: 'user-1' })).toThrow('JWT_KEY environment variable is not configured properly');
  });

  test('distinguishes expired tokens from other invalid tokens', () => {
    process.env.JWT_KEY = 'a-secure-test-key';
    const expired = jsonwebtoken.sign({ sub: 'user-1' }, process.env.JWT_KEY, { algorithm: 'HS256', expiresIn: -1 });
    expect(() => jwt.verify(expired)).toThrow('Token has expired');
    expect(() => jwt.verify('not-a-token')).toThrow('Invalid token');
  });
});
