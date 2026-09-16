import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { afterEach } from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const validator = path.join(repositoryRoot, 'scripts/validate-docs.mjs');
const fixtureRoots = [];

afterEach(() => {
  fixtureRoots.splice(0).forEach(root => {
    rmSync(root, { force: true, recursive: true });
  });
});

const createFixture = files => {
  const root = mkdtempSync(path.join(tmpdir(), 'defy-doc-validator-'));

  fixtureRoots.push(root);

  Object.entries(files).forEach(([file, contents]) => {
    const destination = path.join(root, file);

    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
  });

  return root;
};

const runValidator = (root, check) => {
  return spawnSync(process.execPath, [validator, '--root', root, '--check', check], {
    encoding: 'utf8',
  });
};

const acceptanceDigest = source => {
  return createHash('sha256').update(source).digest('hex');
};

const acceptanceLock = ({ documents, dockerOperations, dockerSmokeFile }) => {
  return `${JSON.stringify(
    {
      version: 1,
      algorithm: 'sha256',
      documents: documents.map(entry => ({ ...entry, sha256: acceptanceDigest(entry.source) })).map(({ source, ...entry }) => entry),
      dockerOperations: dockerOperations.map(entry => ({ ...entry, sha256: acceptanceDigest(entry.source) })).map(({ source, ...entry }) => entry),
      dockerSmokeFile: dockerSmokeFile
        ? { ...dockerSmokeFile, sha256: acceptanceDigest(dockerSmokeFile.source), source: undefined }
        : undefined,
    },
    null,
    2,
  )}\n`;
};

test('links check accepts existing files and GitHub-style heading anchors', () => {
  const root = createFixture({
    'README.md': '# Project\n\nSee [operations](./docs/operations.md#safe-restart).\n',
    'docs/operations.md': '# Operations\n\n## Safe restart\n',
  });

  const result = runValidator(root, 'links');

  assert.equal(result.status, 0, result.stderr);
});

test('links check rejects a missing relative target', () => {
  const root = createFixture({
    'README.md': '# Project\n\nSee [missing](./docs/missing.md).\n',
  });

  const result = runValidator(root, 'links');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /docs\/missing\.md/);
});

test('format check ignores generated browser test artifacts', () => {
  const root = createFixture({
    'README.md': '# Project\n',
    'frontend/playwright-report/error-context.md': '# Generated report without newline',
    'frontend/test-results/example/error-context.md': '# Generated result without newline',
  });

  const result = runValidator(root, 'format');

  assert.equal(result.status, 0, result.stderr);
});

test('env check accepts every source-backed backend setting and file variant', () => {
  const root = createFixture({
    'backend/.env.example': [
      'DATABASE_URL=postgres://placeholder',
      '# DATABASE_URL_FILE=/run/secrets/database-url',
      'EMAIL_MODE=disabled',
      'NODE_ENV=development',
      '',
    ].join('\n'),
    'backend/src/config/runtime.js': [
      "const FILE_BACKED_SETTINGS = ['DATABASE_URL'];",
      'const mode = environment.EMAIL_MODE;',
      '',
    ].join('\n'),
    'backend/src/libs/logger.js': "const env = process.env.NODE_ENV;\n",
    'frontend/.env.example': [
      '# Browser requests use same-origin /auth/* through http://localhost:3000.',
      'BASE_URL=http://localhost:3002',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'env');

  assert.equal(result.status, 0, result.stderr);
});

test('env check rejects missing and undocumented backend settings', () => {
  const root = createFixture({
    'backend/.env.example': 'DATABASE_URL=postgres://placeholder\nSTALE_SETTING=true\n',
    'backend/src/config/runtime.js': [
      "const FILE_BACKED_SETTINGS = ['DATABASE_URL'];",
      'const mode = environment.EMAIL_MODE;',
      '',
    ].join('\n'),
    'frontend/.env.example': [
      '# Browser requests use same-origin /auth/* through http://localhost:3000.',
      'BASE_URL=http://localhost:3002',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'env');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_URL_FILE/);
  assert.match(result.stderr, /EMAIL_MODE/);
  assert.match(result.stderr, /STALE_SETTING/);
});

test('env check rejects browser-visible variables in the frontend example', () => {
  const root = createFixture({
    'backend/.env.example': '',
    'frontend/.env.example': [
      '# Browser requests use same-origin /auth/* through http://localhost:3000.',
      'BASE_URL=http://localhost:3002',
      'NEXT_PUBLIC_API_BASE_URL=http://localhost:3002',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'env');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /frontend\/\.env\.example: runtime variables are unsupported: NEXT_PUBLIC_API_BASE_URL/);
});

test('env check requires the frontend same-origin auth contract', () => {
  const root = createFixture({
    'backend/.env.example': '',
    'frontend/.env.example': 'BASE_URL=http://localhost:3002\n',
  });

  const result = runValidator(root, 'env');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /frontend\/\.env\.example: must document same-origin \/auth\/\*/);
});

test('env check requires the server-only frontend auth proxy target', () => {
  const root = createFixture({
    'backend/.env.example': '',
    'frontend/.env.example': '# Browser requests use same-origin /auth/* through http://localhost:3000.\n',
  });

  const result = runValidator(root, 'env');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /frontend\/\.env\.example: missing BASE_URL/);
});

test('env check rejects the renamed frontend auth proxy variable', () => {
  const root = createFixture({
    'backend/.env.example': '',
    'frontend/.env.example': [
      '# Browser requests use same-origin /auth/* through http://localhost:3000.',
      'AUTH_API_BASE_URL=http://localhost:3002',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'env');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /frontend\/\.env\.example: runtime variables are unsupported: AUTH_API_BASE_URL/);
});

test('workflow check accepts a full action SHA with a version comment', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'workflows');

  assert.equal(result.status, 0, result.stderr);
});

test('workflow check rejects mutable action references', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': [
      'jobs:',
      '  test:',
      '    steps:',
      '      - uses: actions/checkout@v7',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'workflows');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /full commit SHA/);
});

test('workflow check accepts public-only CodeQL with least-privilege result upload', () => {
  const root = createFixture({
    '.github/workflows/codeql.yml': [
      'permissions:',
      '  contents: read',
      'jobs:',
      '  analyze:',
      "    if: github.event.repository.visibility == 'public'",
      '    permissions:',
      '      contents: read',
      '      security-events: write',
      '    steps:',
      '      - uses: github/codeql-action/init@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28 # v4 (2026-08-21)',
      '      - uses: github/codeql-action/analyze@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28 # v4 (2026-08-21)',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'workflows');

  assert.equal(result.status, 0, result.stderr);
});

test('workflow check rejects CodeQL without a public-visibility guard', () => {
  const root = createFixture({
    '.github/workflows/codeql.yml': [
      'permissions:',
      '  contents: read',
      'jobs:',
      '  analyze:',
      '    permissions:',
      '      contents: read',
      '      security-events: write',
      '    steps:',
      '      - uses: github/codeql-action/init@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28 # v4 (2026-08-21)',
      '      - uses: github/codeql-action/analyze@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28 # v4 (2026-08-21)',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'workflows');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must skip CodeQL unless repository visibility is public/);
});

test('workflow check requires CodeQL permission to upload public results', () => {
  const root = createFixture({
    '.github/workflows/codeql.yml': [
      'permissions:',
      '  contents: read',
      'jobs:',
      '  analyze:',
      "    if: github.event.repository.visibility == 'public'",
      '    permissions:',
      '      contents: read',
      '    steps:',
      '      - uses: github/codeql-action/init@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28 # v4 (2026-08-21)',
      '      - uses: github/codeql-action/analyze@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28 # v4 (2026-08-21)',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'workflows');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must grant security-events: write for public Code Scanning upload/);
});

test('workflow check rejects offline SARIF as a private CodeQL workaround', () => {
  const root = createFixture({
    '.github/workflows/codeql.yml': [
      'permissions:',
      '  contents: read',
      'jobs:',
      '  analyze:',
      "    if: github.event.repository.visibility == 'public'",
      '    permissions:',
      '      contents: read',
      '      security-events: write',
      '    steps:',
      '      - uses: github/codeql-action/init@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28 # v4 (2026-08-21)',
      '      - uses: github/codeql-action/analyze@db488ddef3bf6cb639b32c2e9a7c0a7ea8271d28 # v4 (2026-08-21)',
      '        with:',
      '          upload: never',
      '          output: artifacts/codeql',
      '      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1',
      '        with:',
      '          path: artifacts/codeql',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'workflows');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /public CodeQL must use normal Code Scanning upload/);
});

test('workflow check requires full and production audits for every dependency graph', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': [
      'name: CI',
      'jobs:',
      '  quality:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - run: npm audit --omit=dev --audit-level=high',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'workflows');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing full dependency audit: npm --prefix frontend audit --audit-level=low/);
  assert.match(result.stderr, /missing production dependency audit: npm --prefix backend audit --omit=dev --audit-level=high/);
});

test('commands check accepts shell-valid fenced bash examples', () => {
  const root = createFixture({
    'notes.md': '# Project\n\n```bash\nvalue="safe"\nprintf \'%s\\n\' "$value"\n```\n',
  });

  const result = runValidator(root, 'commands');

  assert.equal(result.status, 0, result.stderr);
});

test('commands check rejects a shell-invalid fenced bash example', () => {
  const root = createFixture({
    'README.md': '# Project\n\n```bash\nif true; then\nprintf \'broken\\n\'\n```\n',
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid bash example/);
});

test('commands check rejects an unlinked runnable block in an acceptance document', () => {
  const root = createFixture({
    'README.md': '# Project\n\n```bash\nnpm run verify\n```\n',
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing command-acceptance linkage/);
});

test('commands check links quality and Docker examples to operations invoked by Ubuntu CI', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': [
      'jobs:',
      '  quality:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - run: npm run verify',
      '  docker-acceptance:',
      '    runs-on: ubuntu-24.04',
      '    steps:',
      '      - run: npm run test:docker:smoke',
      '',
    ].join('\n'),
    'README.md': [
      '# Project',
      '',
      '<!-- command-acceptance: ci:quality -->',
      '```bash',
      'npm run verify',
      '```',
      '',
      '<!-- command-acceptance: ci:docker:readiness -->',
      '```bash',
      'curl https://localhost:3001/health/ready',
      '```',
      '',
    ].join('\n'),
    'scripts/docker-smoke.sh': [
      'main() {',
      '  # docs-acceptance: readiness',
      '  curl https://127.0.0.1:3001/health/ready',
      '}',
      'main "$@"',
      '',
    ].join('\n'),
    'scripts/docs-acceptance-lock.json': acceptanceLock({
      documents: [
        { file: 'README.md', block: 1, reference: 'ci:quality', source: 'npm run verify' },
        { file: 'README.md', block: 2, reference: 'ci:docker:readiness', source: 'curl https://localhost:3001/health/ready' },
      ],
      dockerOperations: [
        { file: 'scripts/docker-smoke.sh', operation: 'readiness', source: '  curl https://127.0.0.1:3001/health/ready' },
      ],
      dockerSmokeFile: {
        file: 'scripts/docker-smoke.sh',
        source: 'main() {\n  # docs-acceptance: readiness\n  curl https://127.0.0.1:3001/health/ready\n}\nmain "$@"\n',
      },
    }),
  });

  const result = runValidator(root, 'commands');

  assert.equal(result.status, 0, result.stderr);
});

test('commands check rejects a Docker linkage whose operation marker is not live-tested', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': '# Project\n\n<!-- command-acceptance: ci:docker:identity -->\n```bash\ncurl https://localhost:3001/identity\n```\n',
    'scripts/docker-smoke.sh': '# docs-acceptance: readiness\n',
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing live Docker operation identity/);
});

test('commands check rejects a Docker marker that does not match the fenced command capability', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': '# Project\n\n<!-- command-acceptance: ci:docker:readiness -->\n```bash\ncurl https://localhost:3001/identity\n```\n',
    'scripts/docker-smoke.sh': [
      'main() {',
      '  # docs-acceptance: readiness',
      '  curl https://127.0.0.1:3001/health/ready',
      '}',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /identity.*not valid for Docker operation readiness/);
});

test('commands check rejects live public isolation that uses POST for a documented GET JWT route', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': [
      '# Project',
      '',
      '<!-- command-acceptance: ci:docker:public-404 -->',
      '```bash',
      'test "$(public_status GET \'/travel-rule/trp/inquiries\')" = \'404\'',
      '```',
      '',
    ].join('\n'),
    'scripts/docker-smoke.sh': [
      'main() {',
      '  # docs-acceptance: public-404',
      "  assert_public_route_isolated POST '/travel-rule/trp/inquiries'",
      '}',
      'assert_public_route_isolated() {',
      "  if [[ \"$status\" != '404' ]]; then return 1; fi",
      '}',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing live Docker capability public-jwt-inquiries-get-404/);
});

test('commands check rejects live public isolation that omits the documented JWT management route', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': [
      '# Project',
      '',
      '<!-- command-acceptance: ci:docker:public-404 -->',
      '```bash',
      'test "$(public_status GET \'/travel-rule/trp/management/analytics\')" = \'404\'',
      '```',
      '',
    ].join('\n'),
    'scripts/docker-smoke.sh': [
      'main() {',
      '  # docs-acceptance: public-404',
      "  assert_public_route_isolated GET '/travel-rule/trp/inquiries'",
      '}',
      'assert_public_route_isolated() {',
      "  if [[ \"$status\" != '404' ]]; then return 1; fi",
      '}',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing live Docker capability public-jwt-management-get-404/);
});

test('commands check rejects a capability that is outside its reachable acceptance marker section', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': '# Project\n\n<!-- command-acceptance: ci:docker:readiness -->\n```bash\ncurl https://localhost:3001/health/ready\n```\n',
    'scripts/docker-smoke.sh': [
      'dead_readiness_check() {',
      '  # docs-acceptance: readiness',
      '  true',
      '}',
      'main() {',
      '  # docs-acceptance: identity',
      '  curl https://127.0.0.1:3001/health/ready',
      '}',
      'main "$@"',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /readiness.*reachable main acceptance section/);
});

test('commands check rejects an uncovered executable appended to a recognized Docker block', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': [
      '# Project',
      '',
      '<!-- command-acceptance: ci:docker:readiness -->',
      '```bash',
      'curl https://localhost:3001/health/ready',
      'docker compose exec -T backend echo uncovered',
      '```',
      '',
    ].join('\n'),
    'scripts/docker-smoke.sh': [
      'main() {',
      '  # docs-acceptance: readiness',
      '  curl https://127.0.0.1:3001/health/ready',
      '}',
      'main "$@"',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uncovered executable command.*docker compose exec/);
});

test('commands check rejects a capability that exists only in an inline shell comment', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': '# Project\n\n<!-- command-acceptance: ci:docker:readiness -->\n```bash\ncurl https://localhost:3001/health/ready\n```\n',
    'scripts/docker-smoke.sh': [
      'main() {',
      '  # docs-acceptance: readiness',
      '  true # curl https://127.0.0.1:3001/health/ready',
      '}',
      'main "$@"',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing reachable live Docker capability readiness-ready-get/);
});

test('commands check rejects an acceptance main that is invoked only by a dead helper', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': '# Project\n\n<!-- command-acceptance: ci:docker:readiness -->\n```bash\ncurl https://localhost:3001/health/ready\n```\n',
    'scripts/docker-smoke.sh': [
      'dead_wrapper() {',
      '  main "$@"',
      '}',
      'main() {',
      '  # docs-acceptance: readiness',
      '  curl https://127.0.0.1:3001/health/ready',
      '}',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /readiness.*reachable main acceptance section/);
});

test('commands check rejects a live capability hidden behind false control flow', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': '# Project\n\n<!-- command-acceptance: ci:docker:readiness -->\n```bash\ncurl https://localhost:3001/health/ready\n```\n',
    'scripts/docker-smoke.sh': [
      'main() {',
      '  # docs-acceptance: readiness',
      '  if false; then',
      '    curl https://127.0.0.1:3001/health/ready',
      '  fi',
      '}',
      'main "$@"',
      '',
    ].join('\n'),
    'scripts/docs-acceptance-lock.json': acceptanceLock({
      documents: [{ file: 'README.md', block: 1, reference: 'ci:docker:readiness', source: 'curl https://localhost:3001/health/ready' }],
      dockerOperations: [
        { file: 'scripts/docker-smoke.sh', operation: 'readiness', source: '  curl https://127.0.0.1:3001/health/ready' },
      ],
      dockerSmokeFile: {
        file: 'scripts/docker-smoke.sh',
        source: 'main() {\n  # docs-acceptance: readiness\n  curl https://127.0.0.1:3001/health/ready\n}\nmain "$@"\n',
      },
    }),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /acceptance lock mismatch.*readiness/);
});

test('commands check rejects an early return before the first live operation marker', () => {
  const lockedSmoke = [
    'main() {',
    '  # docs-acceptance: readiness',
    '  curl https://127.0.0.1:3001/health/ready',
    '}',
    'main "$@"',
    '',
  ].join('\n');
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': '# Project\n\n<!-- command-acceptance: ci:docker:readiness -->\n```bash\ncurl https://localhost:3001/health/ready\n```\n',
    'scripts/docker-smoke.sh': lockedSmoke.replace('main() {\n', 'main() {\n  return 0\n'),
    'scripts/docs-acceptance-lock.json': acceptanceLock({
      documents: [{ file: 'README.md', block: 1, reference: 'ci:docker:readiness', source: 'curl https://localhost:3001/health/ready' }],
      dockerOperations: [
        { file: 'scripts/docker-smoke.sh', operation: 'readiness', source: '  curl https://127.0.0.1:3001/health/ready' },
      ],
      dockerSmokeFile: { file: 'scripts/docker-smoke.sh', source: lockedSmoke },
    }),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /acceptance lock mismatch.*Docker smoke full source/);
});

test('commands check rejects a top-level exit before the live main invocation', () => {
  const lockedSmoke = [
    'main() {',
    '  # docs-acceptance: readiness',
    '  curl https://127.0.0.1:3001/health/ready',
    '}',
    'main "$@"',
    '',
  ].join('\n');
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': '# Project\n\n<!-- command-acceptance: ci:docker:readiness -->\n```bash\ncurl https://localhost:3001/health/ready\n```\n',
    'scripts/docker-smoke.sh': lockedSmoke.replace('main "$@"', 'exit 0\nmain "$@"'),
    'scripts/docs-acceptance-lock.json': acceptanceLock({
      documents: [{ file: 'README.md', block: 1, reference: 'ci:docker:readiness', source: 'curl https://localhost:3001/health/ready' }],
      dockerOperations: [
        { file: 'scripts/docker-smoke.sh', operation: 'readiness', source: '  curl https://127.0.0.1:3001/health/ready' },
      ],
      dockerSmokeFile: { file: 'scripts/docker-smoke.sh', source: lockedSmoke },
    }),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /acceptance lock mismatch.*Docker smoke full source/);
});

test('commands check rejects mixed line endings in a Docker smoke continuation', () => {
  const lockedSmoke = [
    'main() {',
    '  # docs-acceptance: readiness',
    '  curl \\',
    '    https://127.0.0.1:3001/health/ready',
    '}',
    'main "$@"',
    '',
  ].join('\n');
  const mixedEolSmoke = lockedSmoke.replace('  curl \\\n', '  curl \\\r\n');
  const syntaxCheck = spawnSync('bash', ['-n'], { input: mixedEolSmoke });

  assert.equal(syntaxCheck.status, 0, syntaxCheck.stderr?.toString());

  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': '# Project\n\n<!-- command-acceptance: ci:docker:readiness -->\n```bash\ncurl https://localhost:3001/health/ready\n```\n',
    'scripts/docker-smoke.sh': mixedEolSmoke,
    'scripts/docs-acceptance-lock.json': acceptanceLock({
      documents: [{ file: 'README.md', block: 1, reference: 'ci:docker:readiness', source: 'curl https://localhost:3001/health/ready' }],
      dockerOperations: [
        { file: 'scripts/docker-smoke.sh', operation: 'readiness', source: '  curl \\\n    https://127.0.0.1:3001/health/ready' },
      ],
      dockerSmokeFile: { file: 'scripts/docker-smoke.sh', source: lockedSmoke },
    }),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /acceptance lock mismatch.*Docker smoke full source/);
});

test('commands check rejects a command substitution hidden in a documented local declaration', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': [
      '# Project',
      '',
      '<!-- command-acceptance: ci:docker:readiness -->',
      '```bash',
      'hidden_command() {',
      '  local uncovered=$(docker compose exec -T backend echo uncovered)',
      '}',
      'curl https://localhost:3001/health/ready',
      '```',
      '',
    ].join('\n'),
    'scripts/docker-smoke.sh': [
      'main() {',
      '  # docs-acceptance: readiness',
      '  curl https://127.0.0.1:3001/health/ready',
      '}',
      'main "$@"',
      '',
    ].join('\n'),
    'scripts/docs-acceptance-lock.json': acceptanceLock({
      documents: [{ file: 'README.md', block: 1, reference: 'ci:docker:readiness', source: 'curl https://localhost:3001/health/ready' }],
      dockerOperations: [
        { file: 'scripts/docker-smoke.sh', operation: 'readiness', source: '  curl https://127.0.0.1:3001/health/ready' },
      ],
      dockerSmokeFile: {
        file: 'scripts/docker-smoke.sh',
        source: 'main() {\n  # docs-acceptance: readiness\n  curl https://127.0.0.1:3001/health/ready\n}\nmain "$@"\n',
      },
    }),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /acceptance lock mismatch.*README\.md.*block 1/);
});

test('commands check rejects a duplicate acceptance lock entry', () => {
  const document = { file: 'README.md', block: 1, reference: 'ci:docker:readiness', source: 'curl https://localhost:3001/health/ready' };
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': '# Project\n\n<!-- command-acceptance: ci:docker:readiness -->\n```bash\ncurl https://localhost:3001/health/ready\n```\n',
    'scripts/docker-smoke.sh': 'main() {\n  # docs-acceptance: readiness\n  curl https://127.0.0.1:3001/health/ready\n}\nmain "$@"\n',
    'scripts/docs-acceptance-lock.json': acceptanceLock({
      documents: [document, document],
      dockerOperations: [
        { file: 'scripts/docker-smoke.sh', operation: 'readiness', source: '  curl https://127.0.0.1:3001/health/ready' },
      ],
      dockerSmokeFile: {
        file: 'scripts/docker-smoke.sh',
        source: 'main() {\n  # docs-acceptance: readiness\n  curl https://127.0.0.1:3001/health/ready\n}\nmain "$@"\n',
      },
    }),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate acceptance lock entry.*README\.md.*block 1/);
});

test('commands check rejects a missing acceptance lock entry', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': '# Project\n\n<!-- command-acceptance: ci:docker:readiness -->\n```bash\ncurl https://localhost:3001/health/ready\n```\n',
    'scripts/docker-smoke.sh': 'main() {\n  # docs-acceptance: readiness\n  curl https://127.0.0.1:3001/health/ready\n}\nmain "$@"\n',
    'scripts/docs-acceptance-lock.json': acceptanceLock({
      documents: [],
      dockerOperations: [
        { file: 'scripts/docker-smoke.sh', operation: 'readiness', source: '  curl https://127.0.0.1:3001/health/ready' },
      ],
      dockerSmokeFile: {
        file: 'scripts/docker-smoke.sh',
        source: 'main() {\n  # docs-acceptance: readiness\n  curl https://127.0.0.1:3001/health/ready\n}\nmain "$@"\n',
      },
    }),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing acceptance lock entry.*README\.md.*block 1/);
});

test('commands check rejects an extra acceptance lock entry', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': '# Project\n\n<!-- command-acceptance: ci:docker:readiness -->\n```bash\ncurl https://localhost:3001/health/ready\n```\n',
    'scripts/docker-smoke.sh': 'main() {\n  # docs-acceptance: readiness\n  curl https://127.0.0.1:3001/health/ready\n}\nmain "$@"\n',
    'scripts/docs-acceptance-lock.json': acceptanceLock({
      documents: [
        { file: 'README.md', block: 1, reference: 'ci:docker:readiness', source: 'curl https://localhost:3001/health/ready' },
        { file: 'README.md', block: 2, reference: 'ci:quality', source: 'npm run verify' },
      ],
      dockerOperations: [
        { file: 'scripts/docker-smoke.sh', operation: 'readiness', source: '  curl https://127.0.0.1:3001/health/ready' },
      ],
      dockerSmokeFile: {
        file: 'scripts/docker-smoke.sh',
        source: 'main() {\n  # docs-acceptance: readiness\n  curl https://127.0.0.1:3001/health/ready\n}\nmain "$@"\n',
      },
    }),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /extra acceptance lock entry.*README\.md.*block 2/);
});

test('commands check reports a malformed acceptance lock entry without crashing', () => {
  const root = createFixture({
    'README.md': '# Project\n\n<!-- command-acceptance: ci:quality -->\n```bash\nnpm run verify\n```\n',
    'scripts/docs-acceptance-lock.json': `${JSON.stringify({ version: 1, algorithm: 'sha256', documents: [null], dockerOperations: [] })}\n`,
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /acceptance lock contains an invalid document entry/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});

test('commands check requires a Docker smoke full-source lock entry', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  quality:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run verify\n',
    'README.md': '# Project\n\n<!-- command-acceptance: ci:quality -->\n```bash\nnpm run verify\n```\n',
    'scripts/docs-acceptance-lock.json': acceptanceLock({
      documents: [{ file: 'README.md', block: 1, reference: 'ci:quality', source: 'npm run verify' }],
      dockerOperations: [],
    }),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /acceptance lock must contain Docker smoke full-source entry/);
});

test('commands check rejects extra Docker smoke full-source metadata', () => {
  const smoke = 'main() {\n}\nmain "$@"\n';
  const root = createFixture({
    'scripts/docker-smoke.sh': smoke,
    'scripts/docs-acceptance-lock.json': acceptanceLock({
      documents: [],
      dockerOperations: [],
      dockerSmokeFile: { file: 'scripts/docker-smoke.sh', source: smoke, extra: 'unreviewed' },
    }),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Docker smoke full-source entry has unexpected fields/);
});

test('commands check rejects malformed Docker smoke full-source metadata', () => {
  const root = createFixture({
    'scripts/docker-smoke.sh': 'main() {\n}\nmain "$@"\n',
    'scripts/docs-acceptance-lock.json': `${JSON.stringify({
      version: 1,
      algorithm: 'sha256',
      documents: [],
      dockerOperations: [],
      dockerSmokeFile: { file: 'scripts/docker-smoke.sh', sha256: 'not-a-digest' },
    })}\n`,
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid Docker smoke full-source entry/);
});

test('commands check rejects uncovered executable JavaScript in an internal API heredoc', () => {
  const root = createFixture({
    '.github/workflows/ci.yml': 'jobs:\n  docker:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run test:docker:smoke\n',
    'README.md': [
      '# Project',
      '',
      '<!-- command-acceptance: ci:docker:internal-api -->',
      '```bash',
      "docker compose exec -T backend node --input-type=module - <<'NODE'",
      "const response = await fetch('http://127.0.0.1:3002/travel-rule/trp/travel-addresses', {",
      "  method: 'POST',",
      '});',
      'if (response.status !== 201) process.exit(1);',
      "console.log('uncovered');",
      'NODE',
      '```',
      '',
    ].join('\n'),
    'scripts/docker-smoke.sh': [
      'assert_internal_api() {',
      "  docker compose exec backend node <<'NODE'",
      "const response = await fetch('http://127.0.0.1:3002/travel-rule/trp/travel-addresses', {",
      "  method: 'POST',",
      '});',
      'if (response.status !== 201) process.exit(1);',
      'NODE',
      '}',
      'main() {',
      '  # docs-acceptance: internal-api',
      '  internal_transfer_id=$(assert_internal_api "$user_jwt")',
      '}',
      'main "$@"',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'commands');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uncovered executable heredoc/);
});

test('commands check allows only narrowly enumerated non-CI reasons', () => {
  const nonCiSmoke = '# No Docker acceptance operation is required for this fixture.\n';
  const acceptedRoot = createFixture({
    'README.md': [
      '# Project',
      '',
      '<!-- command-acceptance: non-ci:external-smtp -->',
      '```bash',
      "export EMAIL_MODE='smtp'",
      "export EMAIL_HOST='smtp.example.test'",
      "export SMTP_PASSWORD_FILE='/approved/password'",
      'docker compose up --build --wait',
      '```',
      '',
    ].join('\n'),
    'scripts/docker-smoke.sh': nonCiSmoke,
    'scripts/docs-acceptance-lock.json': acceptanceLock({
      documents: [
        {
          file: 'README.md',
          block: 1,
          reference: 'non-ci:external-smtp',
          source: [
            "export EMAIL_MODE='smtp'",
            "export EMAIL_HOST='smtp.example.test'",
            "export SMTP_PASSWORD_FILE='/approved/password'",
            'docker compose up --build --wait',
          ].join('\n'),
        },
      ],
      dockerOperations: [],
      dockerSmokeFile: { file: 'scripts/docker-smoke.sh', source: nonCiSmoke },
    }),
  });
  const rejectedRoot = createFixture({
    'README.md': '# Project\n\n<!-- command-acceptance: non-ci:convenience -->\n```bash\necho skipped\n```\n',
    'scripts/docker-smoke.sh': nonCiSmoke,
    'scripts/docs-acceptance-lock.json': acceptanceLock({
      documents: [{ file: 'README.md', block: 1, reference: 'non-ci:convenience', source: 'echo skipped' }],
      dockerOperations: [],
      dockerSmokeFile: { file: 'scripts/docker-smoke.sh', source: nonCiSmoke },
    }),
  });

  const accepted = runValidator(acceptedRoot, 'commands');
  const rejected = runValidator(rejectedRoot, 'commands');

  assert.equal(accepted.status, 0, accepted.stderr);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /unsupported non-CI reason convenience/);
});

test('format check accepts one H1, final newline, and clean whitespace', () => {
  const root = createFixture({
    'README.md': '# Project\n\n## Usage\n\nText.\n',
  });

  const result = runValidator(root, 'format');

  assert.equal(result.status, 0, result.stderr);
});

test('format check accepts a centered HTML H1', () => {
  const root = createFixture({
    'README.md': '<h1 align="center">Project</h1>\n',
  });

  const result = runValidator(root, 'format');

  assert.equal(result.status, 0, result.stderr);
});

test('format check accepts a generated guidance section with its own H1', () => {
  const root = createFixture({
    'AGENTS.md': '# Frontend guidance\n\n# Generated framework guidance\n',
  });

  const result = runValidator(root, 'format');

  assert.equal(result.status, 0, result.stderr);
});

test('format check rejects trailing whitespace and a missing final newline', () => {
  const root = createFixture({
    'README.md': '# Project  \n\nText.',
  });

  const result = runValidator(root, 'format');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /trailing whitespace/);
  assert.match(result.stderr, /final newline/);
});

test('terminology check accepts the canonical local runtime contract', () => {
  const root = createFixture({
    'README.md': [
      '# Defy Travel Rule',
      '',
      'UI and auth: http://localhost:3000.',
      'External TRP: https://localhost:3001.',
      'Internal API: backend:3002. Internal database: postgres:5432.',
      'Roles are `admin` and `user`. Protocol is TRP 3.2.1 with IVMS101.',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'terminology');

  assert.equal(result.status, 0, result.stderr);
});

test('terminology check rejects stale UI ports and build-time API variables', () => {
  const root = createFixture({
    'README.md': [
      '# Project',
      '',
      'UI: http://localhost:3001 using NEXT_PUBLIC_API_BASE_URL.',
      'The renamed native proxy setting is AUTH_API_BASE_URL.',
      '',
    ].join('\n'),
  });

  const result = runValidator(root, 'terminology');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /http:\/\/localhost:3001/);
  assert.match(result.stderr, /NEXT_PUBLIC_API_BASE_URL/);
  assert.match(result.stderr, /AUTH_API_BASE_URL/);
});

test('terminology check rejects a stale API URL in the frontend env example', () => {
  const root = createFixture({
    'README.md': [
      '# Defy Travel Rule',
      '',
      'UI and auth: http://localhost:3000.',
      'External TRP: https://localhost:3001.',
      'Internal API: backend:3002. Internal database: postgres:5432.',
      'Roles are `admin` and `user`. Protocol is TRP 3.2.1 with IVMS101.',
      '',
    ].join('\n'),
    'frontend/.env.example': 'NEXT_PUBLIC_API_BASE_URL=http://localhost:3002\n',
  });

  const result = runValidator(root, 'terminology');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /frontend\/\.env\.example: stale terminology NEXT_PUBLIC_API_BASE_URL/);
});

test('dependencies check accepts notices for every direct production package', () => {
  const root = createFixture({
    'THIRD_PARTY_NOTICES': '# Notices\n\n- `alpha` — MIT\n- `beta` — Apache-2.0\n',
    'backend/package.json': '{"dependencies":{"alpha":"1.0.0"}}\n',
    'frontend/package.json': '{"dependencies":{"beta":"2.0.0"}}\n',
  });

  const result = runValidator(root, 'dependencies');

  assert.equal(result.status, 0, result.stderr);
});

test('dependencies check rejects an omitted direct production package', () => {
  const root = createFixture({
    'THIRD_PARTY_NOTICES': '# Notices\n\n- `alpha` — MIT\n',
    'backend/package.json': '{"dependencies":{"alpha":"1.0.0","ivms101":"2.0.0"}}\n',
    'frontend/package.json': '{"dependencies":{}}\n',
  });

  const result = runValidator(root, 'dependencies');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ivms101/);
});

test('metadata check accepts synchronized runtime and repository metadata', () => {
  const shared = {
    engines: { node: '>=24.0.0 <25.0.0', npm: '>=11.0.0' },
    repository: { type: 'git', url: 'git+https://github.com/getdefy-co/travel-rule.git' },
  };
  const root = createFixture({
    'package.json': `${JSON.stringify(shared)}\n`,
    'backend/package.json': `${JSON.stringify({
      ...shared,
      repository: { ...shared.repository, directory: 'backend' },
    })}\n`,
    'frontend/package.json': `${JSON.stringify({
      ...shared,
      repository: { ...shared.repository, directory: 'frontend' },
    })}\n`,
  });

  const result = runValidator(root, 'metadata');

  assert.equal(result.status, 0, result.stderr);
});

test('metadata check rejects an application with divergent engine requirements', () => {
  const root = createFixture({
    'package.json': '{"engines":{"node":">=24.0.0 <25.0.0","npm":">=11.0.0"}}\n',
    'backend/package.json': '{"engines":{"node":">=24.0.0 <25.0.0","npm":">=11.0.0"}}\n',
    'frontend/package.json': '{"engines":{"node":">=20.0.0","npm":">=10.0.0"}}\n',
  });

  const result = runValidator(root, 'metadata');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /frontend\/package\.json: engines must match package\.json/);
});
