import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);

test('Playwright Docker failures are written and uploaded from the frontend test-results directory', () => {
  const config = require(path.join(repositoryRoot, 'frontend/playwright.docker.config.js'));
  const workflow = readFileSync(path.join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');

  assert.equal(config.outputDir, path.join(repositoryRoot, 'frontend/test-results'));
  assert.match(workflow, /^\s*path:\s*frontend\/test-results\s*$/m);
  assert.doesNotMatch(workflow, /^\s*(?:path:\s*)?(?:frontend\/)?playwright-report\s*$/m);
});
