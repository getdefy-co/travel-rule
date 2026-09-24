module.exports = {
  clearMocks: true,
  collectCoverageFrom: ['src/controllers/**/*.js', 'src/database/**/*.js', 'src/libs/**/*.js', 'src/requests/**/*.js', 'src/routers/**/*.js'],
  coverageDirectory: 'coverage',
  coverageProvider: 'babel',
  coverageReporters: ['text', 'text-summary', 'lcov'],
  coverageThreshold: {
    './src/controllers/': {
      branches: 90,
      functions: 100,
      lines: 95,
      statements: 95,
    },
    './src/database/': {
      branches: 90,
      functions: 100,
      lines: 95,
      statements: 95,
    },
    './src/libs/': {
      branches: 90,
      functions: 100,
      lines: 95,
      statements: 95,
    },
    './src/requests/': {
      branches: 90,
      functions: 100,
      lines: 95,
      statements: 95,
    },
    './src/routers/': {
      branches: 90,
      functions: 100,
      lines: 95,
      statements: 95,
    },
  },
  restoreMocks: true,
  setupFilesAfterEnv: ['<rootDir>/tests/setupAfterEnv.js'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/unit/**/*.test.js'],
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
};
