module.exports = {
  clearMocks: true,
  restoreMocks: true,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/e2e/**/*.test.js'],
  testTimeout: 60000,
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
};
