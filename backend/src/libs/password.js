import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

const hashPassword = async plaintext => {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
};

const comparePassword = async (plaintext, storedHash) => {
  return bcrypt.compare(plaintext, storedHash);
};

export default { hashPassword, comparePassword };
