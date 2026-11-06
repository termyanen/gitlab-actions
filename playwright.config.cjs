const path = require('node:path');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(__dirname, 'node_modules/.cache/ms-playwright');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
