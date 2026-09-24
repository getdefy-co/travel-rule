const { defineConfig } = require('@playwright/test');
const path = require('node:path');

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: /.*\.docker\.spec\.js/,
  fullyParallel: false,
  outputDir: path.join(__dirname, 'test-results'),
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
