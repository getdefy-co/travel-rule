jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));

const bcrypt = require('bcrypt');
const password = require('../../../src/libs/password').default;

describe('password', () => {
  test('hashes plaintext with the configured work factor', async () => {
    bcrypt.hash.mockResolvedValue('$2b$fixture');
    await expect(password.hashPassword('secret')).resolves.toBe('$2b$fixture');
    expect(bcrypt.hash).toHaveBeenCalledWith('secret', 12);
  });

  test('returns bcrypt comparison result and propagates failures', async () => {
    bcrypt.compare.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('bcrypt failed'));
    await expect(password.comparePassword('secret', '$2b$fixture')).resolves.toBe(true);
    await expect(password.comparePassword('secret', '$2b$bad')).rejects.toThrow('bcrypt failed');
  });
});
