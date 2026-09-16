#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateAcceptanceLock } from './docs-acceptance-lock.mjs';

const EXCLUDED_DIRECTORIES = new Set(['.git', '.next', '.superpowers', 'coverage', 'dist', 'node_modules', 'playwright-report', 'test-results']);
const SUPPORTED_CHECKS = new Set(['all', 'commands', 'dependencies', 'env', 'format', 'links', 'metadata', 'terminology', 'workflows']);

const parseArguments = argv => {
  const options = { check: 'all', root: process.cwd() };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--root' || argument === '--check') {
      const value = argv[index + 1];

      if (!value) {
        throw new Error(`${argument} requires a value`);
      }

      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${argument}`);
  }

  if (!SUPPORTED_CHECKS.has(options.check)) {
    throw new Error(`unknown check: ${options.check}`);
  }

  return { check: options.check, root: path.resolve(options.root) };
};

const walkFiles = (root, predicate) => {
  if (!existsSync(root)) {
    return [];
  }

  const files = [];

  readdirSync(root, { withFileTypes: true }).forEach(entry => {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) {
      return;
    }

    const target = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkFiles(target, predicate));
    } else if (entry.isFile() && predicate(target)) {
      files.push(target);
    }
  });

  return files.sort();
};

const relativeName = (root, file) => {
  return path.relative(root, file).split(path.sep).join('/');
};

const stripShellComment = line => {
  let singleQuoted = false;
  let doubleQuoted = false;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\' && !singleQuoted) {
      escaped = true;
      continue;
    }

    if (character === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
      continue;
    }

    if (character === '"' && !singleQuoted) {
      doubleQuoted = !doubleQuoted;
      continue;
    }

    if (character === '#' && !singleQuoted && !doubleQuoted && (index === 0 || /[\s;|&()]/.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }

  return line;
};

const normalizeShell = source => {
  return source
    .split('\n')
    .map(stripShellComment)
    .join('\n')
    .replace(/\\\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const matchesAll = (source, patterns) => {
  return patterns.every(pattern => pattern.test(source));
};

const DOCKER_COMMAND_CAPABILITIES = [
  {
    id: 'stack-up-build-wait',
    operations: ['stack-start'],
    document: [/docker compose up --build --wait/],
    live: [/"\$\{compose\[@\]\}" up --build --wait/],
  },
  {
    id: 'compose-ps',
    operations: ['stack-lifecycle', 'stack-start'],
    document: [/docker compose ps/],
    live: [/"\$\{compose\[@\]\}" ps/],
  },
  {
    id: 'gateway-login-page-get',
    operations: ['restart-persistence', 'stack-lifecycle'],
    document: [/curl --fail --silent --show-error http:\/\/localhost:3000\/login >\/dev\/null/],
    live: [/curl --fail --silent --show-error http:\/\/127\.0\.0\.1:3000\/login >\/dev\/null/],
  },
  {
    id: 'compose-down-preserve-volumes',
    operations: ['cleanup', 'stack-lifecycle'],
    document: [/docker compose down(?! --volumes)(?: |$)/],
    live: [/"\$\{compose\[@\]\}" down(?! --volumes)(?: |$)/],
  },
  {
    id: 'compose-up-wait',
    operations: ['readiness-failure', 'restart-persistence', 'stack-lifecycle'],
    document: [/docker compose up --wait/],
    live: [/"\$\{compose\[@\]\}" up --wait/],
  },
  {
    id: 'compose-down-delete-volumes',
    operations: ['cleanup'],
    document: [/docker compose down --volumes/],
    live: [/"\$\{compose\[@\]\}" down --volumes --remove-orphans/, /clean_teardown rm -rf "\$fixture_root"/],
  },
  {
    id: 'fixture-directory-export',
    operations: ['fixture-export'],
    document: [/TRP_FIXTURE_DIR=\$\(mktemp -d /],
    live: [/fixture_root=\$\(mktemp -d /],
  },
  {
    id: 'fixture-certificates-export',
    operations: ['fixture-export'],
    document: [/docker compose cp runtime-bootstrap:\/runtime\/backend\/current\/ca-cert\.pem/, /docker compose cp runtime-bootstrap:\/runtime\/backend\/current\/client-cert\.pem/, /docker compose cp runtime-bootstrap:\/runtime\/backend\/current\/client-key\.pem/],
    live: [/copy_runtime_file ca-cert\.pem/, /copy_runtime_file client-cert\.pem/, /copy_runtime_file client-key\.pem/],
  },
  {
    id: 'fixture-client-key-mode',
    operations: ['fixture-export'],
    document: [/chmod 0600 "\$TRP_FIXTURE_DIR\/client-key\.pem"/],
    live: [/chmod 0600 "\$fixture_root\/client-key\.pem"/],
  },
  {
    id: 'readiness-live-get',
    operations: ['readiness'],
    document: [/https:\/\/localhost:3001\/health\/live/],
    live: [/https:\/\/127\.0\.0\.1:3001\/health\/live/],
  },
  {
    id: 'readiness-ready-get',
    operations: ['readiness', 'readiness-failure'],
    document: [/https:\/\/localhost:3001\/health\/ready/],
    live: [/https:\/\/127\.0\.0\.1:3001\/health\/ready/],
  },
  {
    id: 'readiness-postgres-503',
    operations: ['readiness-failure'],
    document: [/docker compose stop postgres/, /https:\/\/localhost:3001\/health\/ready/, /test "\$status" = '503'/, /docker compose start postgres/, /docker compose up --wait/],
    live: [/"\$\{compose\[@\]\}" stop postgres/, /unavailable_status=\$\(curl[^)]*\/health\/ready\)/, /\[ "\$unavailable_status" = '503' \]/, /"\$\{compose\[@\]\}" start postgres/, /"\$\{compose\[@\]\}" up --wait/],
  },
  {
    id: 'identity-get',
    operations: ['identity', 'restart-persistence'],
    document: [/https:\/\/localhost:3001\/identity/],
    live: [/identity=\$\(curl[^)]*https:\/\/127\.0\.0\.1:3001\/identity\)/, /parsed\.lei !== 'DEFYLOCALVASP0000000'/],
  },
  {
    id: 'public-auth-login-post-404',
    operations: ['public-404'],
    document: [/test "\$\(public_status POST '\/auth\/login' '\{\}'\)" = '404'/],
    live: [/assert_public_route_isolated POST '\/auth\/login' '\{\}'/, /if \[\[ "\$status" != '404' \]\]/],
  },
  {
    id: 'public-jwt-inquiries-get-404',
    operations: ['public-404'],
    document: [/test "\$\(public_status GET '\/travel-rule\/trp\/inquiries'\)" = '404'/],
    live: [/assert_public_route_isolated GET '\/travel-rule\/trp\/inquiries'/, /if \[\[ "\$status" != '404' \]\]/],
  },
  {
    id: 'public-jwt-management-get-404',
    operations: ['public-404'],
    document: [/test "\$\(public_status GET '\/travel-rule\/trp\/management\/analytics'\)" = '404'/],
    live: [/assert_public_route_isolated GET '\/travel-rule\/trp\/management\/analytics'/, /if \[\[ "\$status" != '404' \]\]/],
  },
  {
    id: 'public-api-key-travel-address-post-404',
    operations: ['public-404'],
    document: [/test "\$\(public_status POST '\/travel-rule\/trp\/travel-addresses' '\{\}'\)" = '404'/],
    live: [/assert_public_route_isolated POST '\/travel-rule\/trp\/travel-addresses' '\{\}'/, /if \[\[ "\$status" != '404' \]\]/],
  },
  {
    id: 'public-identity-case-get-404',
    operations: ['public-404'],
    document: [/test "\$\(public_status GET '\/Identity'\)" = '404'/],
    live: [/assert_public_route_isolated GET '\/Identity'/, /if \[\[ "\$status" != '404' \]\]/],
  },
  {
    id: 'public-identity-slash-get-404',
    operations: ['public-404'],
    document: [/test "\$\(public_status GET '\/identity\/'\)" = '404'/],
    live: [/assert_public_route_isolated GET '\/identity\/'/, /if \[\[ "\$status" != '404' \]\]/],
  },
  {
    id: 'public-protocol-slash-post-404',
    operations: ['public-404'],
    document: [/test "\$\(public_status POST '\/travel-rule\/trp\/protocol\/inquiries\/missing-token\/' '\{\}'\)" = '404'/],
    live: [/assert_public_route_isolated POST '\/travel-rule\/trp\/protocol\/inquiries\/missing-token\/' '\{\}'/, /if \[\[ "\$status" != '404' \]\]/],
  },
  {
    id: 'protocol-no-cert-post-401',
    operations: ['no-cert-401'],
    document: [/PROTOCOL_URL='https:\/\/localhost:3001\/travel-rule\/trp\/protocol\/resolutions\/missing-token'/, /--data '\{"rejected":null\}'/, /test "\$status" = '401'/],
    live: [/protocol_request_status without-certificate/, /protocol_url='https:\/\/127\.0\.0\.1:3001\/travel-rule\/trp\/protocol\/resolutions\/missing-token'/, /--data '\{"rejected":null\}'/, /\[ "\$no_certificate_status" = '401' \]/],
  },
  {
    id: 'protocol-trusted-mtls-post-404',
    operations: ['trusted-mtls-404'],
    document: [/--cert "\$TRP_FIXTURE_DIR\/client-cert\.pem"/, /--key "\$TRP_FIXTURE_DIR\/client-key\.pem"/, /--data '\{"rejected":null\}'/, /test "\$status" = '404'/],
    live: [/protocol_request_status with-certificate/, /curl_arguments\+=\(--cert "\$fixture_root\/client-cert\.pem" --key "\$fixture_root\/client-key\.pem"\)/, /\[ "\$mtls_status" = '404' \]/],
  },
  {
    id: 'admin-login-jwt',
    operations: ['admin-login-jwt'],
    document: [/http:\/\/localhost:3000\/auth\/login/, /"email":"admin@getdefy\.co"/, /jq -er '\.data'/],
    live: [/user_jwt=\$\(api_login \| extract_login_token\)/, /http:\/\/127\.0\.0\.1:3000\/auth\/login/, /"email":"admin@getdefy\.co"/],
  },
  {
    id: 'admin-profile-get',
    operations: ['admin-login-jwt'],
    document: [/Authorization: Bearer \$USER_JWT/, /http:\/\/localhost:3000\/auth\/me/],
    live: [/assert_admin_profile "\$user_jwt"/, /http:\/\/127\.0\.0\.1:3000\/auth\/me/],
  },
  {
    id: 'internal-api-key-travel-address-post',
    operations: ['internal-api'],
    document: [/docker compose exec -T backend node --input-type=module/, /fetch\('http:\/\/127\.0\.0\.1:3002\/travel-rule\/trp\/travel-addresses'/, /method: 'POST'/, /response\.status !== 201/],
    live: [/assert_internal_api "\$user_jwt"/, /fetch\('http:\/\/127\.0\.0\.1:3002\/travel-rule\/trp\/travel-addresses'/, /method: 'POST'/, /response\.status !== 201/],
  },
  {
    id: 'internal-jwt-inquiries-get',
    operations: ['internal-api'],
    document: [/docker compose exec -T -e USER_JWT="\$USER_JWT" backend node --input-type=module/, /fetch\('http:\/\/127\.0\.0\.1:3002\/travel-rule\/trp\/inquiries\?page=1&limit=10'/, /authorization: `Bearer \$\{process\.env\.USER_JWT\}`/, /Array\.isArray\(body\.data\)/],
    live: [/assert_internal_api "\$user_jwt"/, /fetch\('http:\/\/127\.0\.0\.1:3002\/travel-rule\/trp\/inquiries\?page=1&limit=10'/, /authorization: `Bearer \$\{process\.env\.USER_JWT\}`/, /Array\.isArray\(body\.data\)/],
  },
  {
    id: 'compose-restart-stateful-services',
    operations: ['restart-persistence'],
    document: [/docker compose restart postgres backend frontend gateway/],
    live: [/"\$\{compose\[@\]\}" restart postgres backend frontend gateway/],
  },
  {
    id: 'bootstrap-jobs-rerun',
    operations: ['bootstrap-idempotency'],
    document: [/docker compose run --rm runtime-bootstrap/, /docker compose run --rm admin-bootstrap/],
    live: [/"\$\{compose\[@\]\}" run --rm runtime-bootstrap/, /"\$\{compose\[@\]\}" run --rm admin-bootstrap/, /assert_persisted_material_unchanged/],
  },
  {
    id: 'full-smoke-command',
    operations: ['full'],
    document: [/npm run test:docker:smoke/],
    live: [],
  },
  {
    id: 'fixture-cleanup',
    operations: ['cleanup'],
    document: [/rm -rf -- "\$TRP_FIXTURE_DIR"/, /unset TRP_FIXTURE_DIR/, /unset LOGIN_RESPONSE USER_JWT REQUEST_IDENTIFIER PROTOCOL_URL/],
    live: [/rm -rf "\$fixture_root"/, /fixture_root=''/],
  },
];

const DOCKER_LIVE_SECTION_PATTERNS = {
  'stack-up-build-wait': [/"\$\{compose\[@\]\}" up --build --wait/],
  'compose-ps': [/"\$\{compose\[@\]\}" ps/],
  'gateway-login-page-get': [/curl --fail --silent --show-error http:\/\/127\.0\.0\.1:3000\/login >\/dev\/null/],
  'compose-down-preserve-volumes': [/"\$\{compose\[@\]\}" down(?! --volumes)(?: |$)/],
  'compose-up-wait': [/"\$\{compose\[@\]\}" up --wait/],
  'compose-down-delete-volumes': [/clean_teardown/],
  'fixture-directory-export': [/fixture_root=\$\(mktemp -d /],
  'fixture-certificates-export': [/copy_runtime_file ca-cert\.pem/, /copy_runtime_file client-cert\.pem/, /copy_runtime_file client-key\.pem/],
  'fixture-client-key-mode': [/chmod 0600 "\$fixture_root\/client-key\.pem"/],
  'readiness-live-get': [/https:\/\/127\.0\.0\.1:3001\/health\/live/],
  'readiness-ready-get': [/https:\/\/127\.0\.0\.1:3001\/health\/ready/],
  'readiness-postgres-503': [
    /"\$\{compose\[@\]\}" stop postgres/,
    /unavailable_status=\$\(curl[^)]*\/health\/ready\)/,
    /\[ "\$unavailable_status" = '503' \]/,
    /"\$\{compose\[@\]\}" start postgres/,
    /"\$\{compose\[@\]\}" up --wait/,
  ],
  'identity-get': [/https:\/\/127\.0\.0\.1:3001\/identity/, /parsed\.lei !== 'DEFYLOCALVASP0000000'/],
  'public-auth-login-post-404': [/assert_public_route_isolated POST '\/auth\/login' '\{\}'/],
  'public-jwt-inquiries-get-404': [/assert_public_route_isolated GET '\/travel-rule\/trp\/inquiries'/],
  'public-jwt-management-get-404': [/assert_public_route_isolated GET '\/travel-rule\/trp\/management\/analytics'/],
  'public-api-key-travel-address-post-404': [/assert_public_route_isolated POST '\/travel-rule\/trp\/travel-addresses' '\{\}'/],
  'public-identity-case-get-404': [/assert_public_route_isolated GET '\/Identity'/],
  'public-identity-slash-get-404': [/assert_public_route_isolated GET '\/identity\/'/],
  'public-protocol-slash-post-404': [/assert_public_route_isolated POST '\/travel-rule\/trp\/protocol\/inquiries\/missing-token\/' '\{\}'/],
  'protocol-no-cert-post-401': [/protocol_request_status without-certificate/, /\[ "\$no_certificate_status" = '401' \]/],
  'protocol-trusted-mtls-post-404': [/protocol_request_status with-certificate/, /\[ "\$mtls_status" = '404' \]/],
  'admin-login-jwt': [/user_jwt=\$\(api_login \| extract_login_token\)/],
  'admin-profile-get': [/assert_admin_profile "\$user_jwt"/],
  'internal-api-key-travel-address-post': [/internal_transfer_id=\$\(assert_internal_api "\$user_jwt"\)/],
  'internal-jwt-inquiries-get': [/internal_transfer_id=\$\(assert_internal_api "\$user_jwt"\)/],
  'compose-restart-stateful-services': [/"\$\{compose\[@\]\}" restart postgres backend frontend gateway/],
  'bootstrap-jobs-rerun': [/"\$\{compose\[@\]\}" run --rm runtime-bootstrap/, /"\$\{compose\[@\]\}" run --rm admin-bootstrap/],
  'full-smoke-command': [/echo 'Docker smoke passed\.'/],
  'fixture-cleanup': [/clean_teardown/, /rm -rf "\$fixture_root"/, /fixture_root=''/],
};

const DOCKER_DOCUMENT_EXECUTABLES = {
  'stack-start': [/^docker compose up --build --wait$/, /^docker compose ps$/],
  'stack-lifecycle': [/^curl --fail --silent --show-error http:\/\/localhost:3000\/login >\/dev\/null$/, /^docker compose ps$/, /^docker compose down$/],
  'restart-persistence': [/^docker compose up --wait$/, /^docker compose restart postgres backend frontend gateway$/, /^curl --fail --silent --show-error http:\/\/localhost:3000\/login >\/dev\/null$/, /^curl .*https:\/\/localhost:3001\/identity >\/dev\/null$/],
  cleanup: [/^docker compose down --volumes$/, /^docker compose down$/, /^rm -rf -- "\$TRP_FIXTURE_DIR"$/, /^unset TRP_FIXTURE_DIR$/, /^unset LOGIN_RESPONSE USER_JWT REQUEST_IDENTIFIER PROTOCOL_URL$/],
  'fixture-export': [
    /^export TRP_FIXTURE_DIR=\$\(mktemp -d /,
    /^docker compose cp runtime-bootstrap:\/runtime\/backend\/current\/(?:ca-cert|client-cert|client-key)\.pem "\$TRP_FIXTURE_DIR\/(?:ca-cert|client-cert|client-key)\.pem"$/,
    /^chmod 0600 "\$TRP_FIXTURE_DIR\/client-key\.pem"$/,
  ],
  readiness: [/^curl .*https:\/\/localhost:3001\/health\/(?:live|ready)$/],
  'readiness-failure': [/^docker compose stop postgres$/, /^status=\$\(curl .*https:\/\/localhost:3001\/health\/ready\)$/, /^test "\$status" = '503'$/, /^docker compose start postgres$/, /^docker compose up --wait$/],
  identity: [/^curl .*https:\/\/localhost:3001\/identity \| jq /],
  'public-404': [
    /^curl "\$\{curl_arguments\[@\]\}" "https:\/\/localhost:3001\$\{path\}"$/,
    /^test "\$\(public_status (?:GET|POST) '\/(?:auth\/login|travel-rule\/trp\/(?:inquiries|management\/analytics|travel-addresses|protocol\/inquiries\/missing-token\/)|Identity|identity\/)'(?: '\{\}')?\)" = '404'$/,
  ],
  'no-cert-401': [/^export REQUEST_IDENTIFIER=/, /^export PROTOCOL_URL=/, /^status=\$\(curl .*"\$PROTOCOL_URL"\)$/, /^test "\$status" = '401'$/],
  'trusted-mtls-404': [/^status=\$\(curl .*"\$PROTOCOL_URL"\)$/, /^test "\$status" = '404'$/],
  'admin-login-jwt': [/^export LOGIN_RESPONSE=\$\(curl .*http:\/\/localhost:3000\/auth\/login\)$/, /^export USER_JWT=\$\(printf .* \| jq -er '\.data'\)$/, /^curl .*http:\/\/localhost:3000\/auth\/me \| jq /],
  'internal-api': [/^docker compose exec -T (?:-e USER_JWT="\$USER_JWT" )?backend node --input-type=module - <<'NODE'$/],
  'bootstrap-idempotency': [/^docker compose run --rm runtime-bootstrap$/, /^docker compose run --rm admin-bootstrap$/],
  full: [/^npm run test:docker:smoke$/],
};

const ACCEPTANCE_DOCUMENT_EXECUTABLES = {
  'ci:quality': [
    /^npm ci$/,
    /^npm ci --prefix backend$/,
    /^npm ci --prefix frontend$/,
    /^npm run verify$/,
    /^npm run verify:docs$/,
    /^npm --prefix frontend run build$/,
  ],
  'ci:e2e': [/^DATABASE_URL='[^']+' npm --prefix backend run test:e2e$/],
  'non-ci:external-smtp': [
    /^export EMAIL_MODE='smtp'$/,
    /^export EMAIL_HOST='[^']+'$/,
    /^export EMAIL_PORT='[^']+'$/,
    /^export EMAIL_USER='[^']+'$/,
    /^export FRONTEND_URL='[^']+'$/,
    /^export SMTP_PASSWORD_FILE='[^']+'$/,
    /^docker compose up --build --wait$/,
  ],
  'non-ci:private-clone': [/^git clone https:\/\/github\.com\/getdefy-co\/travel-rule\.git$/, /^cd travel-rule$/],
};

const DOCKER_DOCUMENT_HEREDOC_DIGESTS = {
  // Exact bodies keep embedded Node behavior inside the same acceptance boundary as its shell invocation.
  'internal-api': new Set([
    '174222ebf36047c02f376fab03fafae2c1a4dfc749998fdc591a4a0869ab7c54',
    'b9aa58a0563e64ad43041f9630933797ea3962e6b6901680061063963e83b2e9',
  ]),
};

const extractShellFunctionBody = (source, name) => {
  const lines = source.split('\n');
  const opening = new RegExp(`^${name}\\(\\) \\{$`);
  const start = lines.findIndex(line => opening.test(line.trim()));

  if (start === -1) {
    return '';
  }

  const body = [];

  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '}') {
      return body.join('\n');
    }
    body.push(lines[index]);
  }

  return '';
};

const extractMainAcceptanceSections = source => {
  const body = extractShellFunctionBody(source, 'main');
  const sections = new Map();
  let operation = null;

  body.split('\n').forEach(line => {
    const marker = /^\s*# docs-acceptance: ([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/.exec(line);

    if (marker) {
      operation = marker[1];
      if (!sections.has(operation)) {
        sections.set(operation, []);
      }
      return;
    }

    if (operation) {
      sections.get(operation).push(line);
    }
  });

  return new Map([...sections].map(([name, lines]) => [name, normalizeShell(lines.join('\n'))]));
};

const hasReachableMainInvocation = source => {
  const directInvocation = /(?:^|\n)main "\$@"[ \t]*\n?$/;
  const guardedInvocation = /(?:^|\n)if \[\[ "\$\{BASH_SOURCE\[0\]\}" == "\$0" \]\]; then\n[ \t]+main "\$@"\nfi[ \t]*\n?$/;

  return directInvocation.test(source) || guardedInvocation.test(source);
};

const shellLogicalLines = source => {
  const logical = [];
  let continuation = '';
  let heredoc = null;
  let inArray = false;

  source.split('\n').forEach(rawLine => {
    const trimmed = rawLine.trim();

    if (heredoc) {
      if (trimmed === heredoc) {
        heredoc = null;
      }
      return;
    }

    if (inArray) {
      if (trimmed === ')') {
        inArray = false;
      }
      return;
    }

    if (!continuation && /^(?:local )?[A-Za-z_][A-Za-z0-9_]*=\($/.test(trimmed)) {
      inArray = true;
      return;
    }

    const next = continuation ? `${continuation} ${trimmed}` : trimmed;

    if (next.endsWith('\\')) {
      continuation = next.slice(0, -1).trimEnd();
      return;
    }

    continuation = '';
    if (!next) {
      return;
    }

    const heredocMatch = /<<-?['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(next);
    if (heredocMatch) {
      heredoc = heredocMatch[1];
    }
    logical.push(normalizeShell(next));
  });

  if (continuation) {
    logical.push(normalizeShell(continuation));
  }

  return logical;
};

const shellExecutableLines = source => {
  const structural = [
    /^# /,
    /^[A-Za-z_][A-Za-z0-9_]*\(\) \{$/,
    /^\{$/,
    /^\}$/,
    /^(?:if|for|while|case)\b.*(?:; then|; do| in)?$/,
    /^(?:then|else|fi|do|done|esac)$/,
    /^local\b/,
    /^[A-Za-z_][A-Za-z0-9_]*\+=\(/,
  ];

  return shellLogicalLines(source).filter(line => {
    return line.length > 0 && !structural.some(pattern => pattern.test(line));
  });
};

const shellHeredocBodies = source => {
  const bodies = [];
  const pattern = /<<-?['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?[^\n]*\n([\s\S]*?)\n\1(?=\n|$)/g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    bodies.push(match[2].trim());
  }

  return bodies;
};

const stripCode = markdown => {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]+`/g, '');
};

const headingAnchors = markdown => {
  const seen = new Map();
  const anchors = new Set();

  markdown.split('\n').forEach(line => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);

    if (!match) {
      return;
    }

    const base = match[2]
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(base) || 0;
    const anchor = count === 0 ? base : `${base}-${count}`;

    seen.set(base, count + 1);
    anchors.add(anchor);
  });

  return anchors;
};

const validateLinks = root => {
  const errors = [];
  const markdownFiles = walkFiles(root, file => file.endsWith('.md'));

  markdownFiles.forEach(file => {
    const markdown = readFileSync(file, 'utf8');
    const linkSource = stripCode(markdown);
    const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
    let match;

    while ((match = linkPattern.exec(linkSource)) !== null) {
      const rawTarget = match[1].replace(/^<|>$/g, '');

      if (/^(?:https?:|mailto:)/i.test(rawTarget)) {
        continue;
      }

      const hashIndex = rawTarget.indexOf('#');
      const targetPath = hashIndex === -1 ? rawTarget : rawTarget.slice(0, hashIndex);
      const fragment = hashIndex === -1 ? '' : decodeURIComponent(rawTarget.slice(hashIndex + 1)).toLowerCase();
      const resolved = targetPath ? path.resolve(path.dirname(file), decodeURIComponent(targetPath)) : file;

      if (!existsSync(resolved)) {
        errors.push(`${relativeName(root, file)}: missing link target ${rawTarget}`);
        continue;
      }

      if (fragment && statSync(resolved).isFile()) {
        const anchors = headingAnchors(readFileSync(resolved, 'utf8'));

        if (!anchors.has(fragment)) {
          errors.push(`${relativeName(root, file)}: missing heading anchor ${rawTarget}`);
        }
      }
    }
  });

  return errors;
};

const sourceEnvironmentNames = root => {
  const sourceRoot = path.join(root, 'backend/src');
  const names = new Set();

  walkFiles(sourceRoot, file => file.endsWith('.js')).forEach(file => {
    const source = readFileSync(file, 'utf8');

    for (const pattern of [/(?:process\.env|environment)\.([A-Z][A-Z0-9_]*)/g, /required(?:Runtime)?\(environment,\s*'([A-Z][A-Z0-9_]*)'/g]) {
      let match;

      while ((match = pattern.exec(source)) !== null) {
        names.add(match[1]);
      }
    }

    const fileBacked = /FILE_BACKED_SETTINGS\s*=\s*\[([^\]]*)\]/.exec(source);

    if (fileBacked) {
      const settingPattern = /'([A-Z][A-Z0-9_]*)'/g;
      let match;

      while ((match = settingPattern.exec(fileBacked[1])) !== null) {
        names.add(match[1]);
        names.add(`${match[1]}_FILE`);
      }
    }
  });

  return names;
};

const validateEnvironment = root => {
  const examplePath = path.join(root, 'backend/.env.example');

  if (!existsSync(examplePath)) {
    return ['backend/.env.example: file is required'];
  }

  const documented = new Set();
  const example = readFileSync(examplePath, 'utf8');
  const assignmentPattern = /^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm;
  let match;

  while ((match = assignmentPattern.exec(example)) !== null) {
    documented.add(match[1]);
  }

  const source = sourceEnvironmentNames(root);
  const missing = [...source].filter(name => !documented.has(name)).sort();
  const stale = [...documented].filter(name => !source.has(name)).sort();
  const errors = [];

  if (missing.length > 0) {
    errors.push(`backend/.env.example: missing ${missing.join(', ')}`);
  }

  if (stale.length > 0) {
    errors.push(`backend/.env.example: undocumented ${stale.join(', ')}`);
  }

  const frontendExamplePath = path.join(root, 'frontend/.env.example');

  if (!existsSync(frontendExamplePath)) {
    errors.push('frontend/.env.example: file is required');
    return errors;
  }

  const frontendExample = readFileSync(frontendExamplePath, 'utf8');
  const frontendVariables = new Set();
  let frontendMatch;

  assignmentPattern.lastIndex = 0;
  while ((frontendMatch = assignmentPattern.exec(frontendExample)) !== null) {
    frontendVariables.add(frontendMatch[1]);
  }

  const supportedFrontendVariables = new Set(['BASE_URL']);
  const unsupportedFrontendVariables = [...frontendVariables].filter(name => !supportedFrontendVariables.has(name)).sort();

  if (unsupportedFrontendVariables.length > 0) {
    errors.push(`frontend/.env.example: runtime variables are unsupported: ${unsupportedFrontendVariables.join(', ')}`);
  }

  if (!frontendVariables.has('BASE_URL')) {
    errors.push('frontend/.env.example: missing BASE_URL');
  }

  if (!frontendExample.includes('same-origin /auth/*') || !frontendExample.includes('http://localhost:3000')) {
    errors.push('frontend/.env.example: must document same-origin /auth/* through http://localhost:3000');
  }

  return errors;
};

const validateWorkflows = root => {
  const workflowRoot = path.join(root, '.github/workflows');
  const errors = [];

  walkFiles(workflowRoot, file => /\.ya?ml$/.test(file)).forEach(file => {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const match = /^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#\s*(.+))?\s*$/.exec(line);

        if (!match || match[1].startsWith('./') || match[1].startsWith('docker://')) {
          return;
        }

        const reference = match[1].split('@').at(-1);

        if (!/^[0-9a-f]{40}$/i.test(reference)) {
          errors.push(`${relativeName(root, file)}:${index + 1}: action must use a full commit SHA`);
        }

        if (!match[2] || !/^v\d/.test(match[2])) {
          errors.push(`${relativeName(root, file)}:${index + 1}: action SHA requires a version comment`);
        }
      });
  });

  const codeqlPath = path.join(workflowRoot, 'codeql.yml');

  if (existsSync(codeqlPath)) {
    const workflow = readFileSync(codeqlPath, 'utf8');
    const publicVisibilityGuard = /^\s*if:\s*(?:\$\{\{\s*)?github\.event\.repository\.visibility\s*==\s*['"]public['"](?:\s*\}\})?\s*$/m;

    if (!publicVisibilityGuard.test(workflow)) {
      errors.push('.github/workflows/codeql.yml: must skip CodeQL unless repository visibility is public');
    }

    if (!/^\s*security-events:\s*write\s*$/m.test(workflow)) {
      errors.push('.github/workflows/codeql.yml: must grant security-events: write for public Code Scanning upload');
    }

    if (!/uses:\s*github\/codeql-action\/analyze@[0-9a-f]{40}/i.test(workflow) || /^\s*upload:\s*never\s*$/m.test(workflow) || /uses:\s*actions\/upload-artifact@[0-9a-f]{40}/i.test(workflow)) {
      errors.push('.github/workflows/codeql.yml: public CodeQL must use normal Code Scanning upload');
    }
  }

  const ciPath = path.join(workflowRoot, 'ci.yml');

  if (existsSync(ciPath)) {
    const workflow = readFileSync(ciPath, 'utf8');

    if (/^name:\s*CI\s*$/m.test(workflow)) {
      const fullAudits = ['npm audit --audit-level=low', 'npm --prefix backend audit --audit-level=low', 'npm --prefix frontend audit --audit-level=low'];
      const productionAudits = [
        'npm audit --omit=dev --audit-level=high',
        'npm --prefix backend audit --omit=dev --audit-level=high',
        'npm --prefix frontend audit --omit=dev --audit-level=high',
      ];

      fullAudits.forEach(command => {
        if (!workflow.includes(command)) {
          errors.push(`.github/workflows/ci.yml: missing full dependency audit: ${command}`);
        }
      });

      productionAudits.forEach(command => {
        if (!workflow.includes(command)) {
          errors.push(`.github/workflows/ci.yml: missing production dependency audit: ${command}`);
        }
      });
    }
  }

  return errors;
};

const validateCommands = root => {
  const errors = validateAcceptanceLock(root);
  const acceptanceFiles = new Set(['README.md', 'docs/manual-trp-testing.md']);
  const allowedNonCiReasons = new Set(['external-smtp', 'private-clone']);
  const workflowPath = path.join(root, '.github/workflows/ci.yml');
  const packagePath = path.join(root, 'package.json');
  const smokePath = path.join(root, 'scripts/docker-smoke.sh');
  const workflow = existsSync(workflowPath) ? readFileSync(workflowPath, 'utf8') : '';
  const smoke = existsSync(smokePath) ? readFileSync(smokePath, 'utf8') : '';
  const normalizedSmoke = normalizeShell(smoke);
  const invokesSmokeMain = hasReachableMainInvocation(smoke);
  const smokeSections = invokesSmokeMain ? extractMainAcceptanceSections(smoke) : new Map();
  const packageManifest = existsSync(packagePath) ? JSON.parse(readFileSync(packagePath, 'utf8')) : {};
  const knownDockerOperations = new Set(DOCKER_COMMAND_CAPABILITIES.flatMap(capability => capability.operations));
  const qualityCapabilities = [
    { id: 'root-install', document: [/^npm ci$/m], live: [/^\s*npm ci\s*$/m] },
    { id: 'backend-install', document: [/^npm ci --prefix backend$/m], live: [/^\s*npm ci --prefix backend\s*$/m] },
    { id: 'frontend-install', document: [/^npm ci --prefix frontend$/m], live: [/^\s*npm ci --prefix frontend\s*$/m] },
    { id: 'repository-verify', document: [/^npm run verify$/m], live: [/^\s*-?\s*run: npm run verify\s*$/m] },
    { id: 'documentation-verify', document: [/^npm run verify:docs$/m], live: [/^\s*-?\s*run: npm run verify\s*$/m] },
    { id: 'frontend-build', document: [/^npm --prefix frontend run build$/m], live: [/^\s*-?\s*run: npm --prefix frontend run build\s*$/m] },
  ];
  const nonCiContracts = {
    'external-smtp': {
      required: [/export EMAIL_MODE='smtp'/, /export EMAIL_HOST=/, /export SMTP_PASSWORD_FILE=/, /docker compose up --build --wait/],
      forbidden: [/git clone/, /psql/],
    },
    'private-clone': {
      required: [/git clone https:\/\/github\.com\/getdefy-co\/travel-rule\.git/, /cd travel-rule/],
      forbidden: [/docker compose/, /npm /, /psql/],
    },
  };

  const validateExecutableCoverage = (name, blockNumber, block, patterns, heredocDigests = new Set()) => {
    shellExecutableLines(block).forEach(line => {
      if (!patterns.some(pattern => pattern.test(line))) {
        errors.push(`${name}: bash example ${blockNumber} has uncovered executable command: ${line}`);
      }
    });

    shellHeredocBodies(block).forEach(body => {
      const digest = createHash('sha256').update(body).digest('hex');

      if (!heredocDigests.has(digest)) {
        errors.push(`${name}: bash example ${blockNumber} has uncovered executable heredoc`);
      }
    });
  };

  const validateLinkage = (name, markdown, fenceIndex, blockNumber, block) => {
    const precedingLine = markdown.slice(0, fenceIndex).trimEnd().split('\n').at(-1) || '';
    const linkage = /^<!-- command-acceptance: ([a-z0-9:-]+) -->$/.exec(precedingLine);

    if (!linkage) {
      errors.push(`${name}: missing command-acceptance linkage for bash example ${blockNumber}`);
      return;
    }

    const reference = linkage[1];

    if (reference === 'ci:quality') {
      validateExecutableCoverage(name, blockNumber, block, ACCEPTANCE_DOCUMENT_EXECUTABLES[reference]);
      const derived = qualityCapabilities.filter(capability => matchesAll(block, capability.document));

      if (derived.length === 0) {
        errors.push(`${name}: bash example ${blockNumber} has no recognized quality capability`);
      }

      if (!workflow.includes('runs-on: ubuntu-24.04')) {
        errors.push(`${name}: quality linkage is not executed by Ubuntu CI`);
      }

      derived.forEach(capability => {
        if (!matchesAll(workflow, capability.live)) {
          errors.push(`${name}: missing Ubuntu CI quality capability ${capability.id}`);
        }
      });

      if (derived.some(capability => capability.id === 'documentation-verify') && !packageManifest.scripts?.verify?.includes('npm run verify:docs')) {
        errors.push(`${name}: documentation verification is not included in the CI repository verifier`);
      }
      return;
    }

    if (reference === 'ci:e2e') {
      validateExecutableCoverage(name, blockNumber, block, ACCEPTANCE_DOCUMENT_EXECUTABLES[reference]);
      if (!/npm --prefix backend run test:e2e/.test(block)) {
        errors.push(`${name}: bash example ${blockNumber} does not invoke the backend e2e capability`);
      }

      if (!workflow.includes('runs-on: ubuntu-24.04') || !workflow.includes('run: npm --prefix backend run test:e2e')) {
        errors.push(`${name}: e2e linkage is not executed by Ubuntu CI`);
      }
      return;
    }

    if (reference.startsWith('ci:docker:')) {
      const operation = reference.slice('ci:docker:'.length);

      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(operation)) {
        errors.push(`${name}: invalid Docker acceptance operation ${operation}`);
        return;
      }

      if (!knownDockerOperations.has(operation)) {
        errors.push(`${name}: unsupported Docker acceptance operation ${operation}`);
        return;
      }

      if (!workflow.includes('runs-on: ubuntu-24.04') || !workflow.includes('run: npm run test:docker:smoke')) {
        errors.push(`${name}: Docker linkage is not executed by Ubuntu CI`);
      }

      const normalizedBlock = normalizeShell(block);
      const derived = DOCKER_COMMAND_CAPABILITIES.filter(capability => matchesAll(normalizedBlock, capability.document));
      const liveSection = smokeSections.get(operation);

      validateExecutableCoverage(
        name,
        blockNumber,
        block,
        DOCKER_DOCUMENT_EXECUTABLES[operation],
        DOCKER_DOCUMENT_HEREDOC_DIGESTS[operation],
      );

      if (!liveSection) {
        errors.push(`${name}: missing live Docker operation ${operation} in reachable main acceptance section`);
      }

      if (derived.length === 0) {
        errors.push(`${name}: bash example ${blockNumber} has no recognized Docker capability for operation ${operation}`);
        return;
      }

      derived.forEach(capability => {
        if (!capability.operations.includes(operation)) {
          errors.push(`${name}: Docker capability ${capability.id} is not valid for Docker operation ${operation}`);
          return;
        }

        const sectionPatterns = DOCKER_LIVE_SECTION_PATTERNS[capability.id] || [];

        if (!liveSection || !matchesAll(liveSection, sectionPatterns)) {
          errors.push(`${name}: missing reachable live Docker capability ${capability.id} in operation ${operation}`);
        }

        if (!matchesAll(normalizedSmoke, capability.live)) {
          errors.push(`${name}: missing live Docker capability ${capability.id}`);
        }
      });
      return;
    }

    if (reference.startsWith('non-ci:')) {
      const reason = reference.slice('non-ci:'.length);

      if (!allowedNonCiReasons.has(reason)) {
        errors.push(`${name}: unsupported non-CI reason ${reason}`);
        return;
      }

      const normalizedBlock = normalizeShell(block);
      const contract = nonCiContracts[reason];

      validateExecutableCoverage(name, blockNumber, block, ACCEPTANCE_DOCUMENT_EXECUTABLES[reference]);

      if (!matchesAll(normalizedBlock, contract.required) || contract.forbidden.some(pattern => pattern.test(normalizedBlock))) {
        errors.push(`${name}: bash example ${blockNumber} does not match non-CI reason ${reason}`);
      }
      return;
    }

    errors.push(`${name}: unsupported command-acceptance linkage ${reference}`);
  };

  walkFiles(root, file => file.endsWith('.md')).forEach(file => {
    const markdown = readFileSync(file, 'utf8');
    const name = relativeName(root, file);
    const fencePattern = /```(?:bash|sh|shell)\s*\n([\s\S]*?)```/g;
    let match;
    let block = 0;

    while ((match = fencePattern.exec(markdown)) !== null) {
      block += 1;
      const result = spawnSync('bash', ['-n'], { encoding: 'utf8', input: match[1] });

      if (acceptanceFiles.has(name)) {
        validateLinkage(name, markdown, match.index, block, match[1]);
      }

      if (result.status !== 0) {
        errors.push(`${name}: invalid bash example ${block}: ${result.stderr.trim()}`);
      }
    }
  });

  return errors;
};

const validateFormat = root => {
  const errors = [];

  walkFiles(root, file => file.endsWith('.md')).forEach(file => {
    const markdown = readFileSync(file, 'utf8');
    const name = relativeName(root, file);
    const h1Count = markdown.split('\n').filter(line => {
      return /^#\s+\S/.test(line) || /^<h1(?:\s+[^>]*)?>\s*\S.*<\/h1>\s*$/i.test(line);
    }).length;

    markdown.split('\n').forEach((line, index) => {
      if (/[\t ]+$/.test(line)) {
        errors.push(`${name}:${index + 1}: trailing whitespace`);
      }
    });

    if (!markdown.endsWith('\n')) {
      errors.push(`${name}: missing final newline`);
    }

    if (h1Count === 0) {
      errors.push(`${name}: expected at least one H1 heading`);
    }
  });

  return errors;
};

const validateTerminology = root => {
  const errors = [];
  const stalePatterns = [
    /http:\/\/localhost:3001/g,
    /localhost:3008/g,
    /AUTH_API_BASE_URL/g,
    /NEXT_PUBLIC_API_BASE_URL/g,
  ];
  const terminologyFiles = walkFiles(root, file => {
    return file.endsWith('.md') || relativeName(root, file) === 'frontend/.env.example';
  });

  terminologyFiles.forEach(file => {
    const contents = readFileSync(file, 'utf8');

    stalePatterns.forEach(pattern => {
      if (pattern.test(contents)) {
        errors.push(`${relativeName(root, file)}: stale terminology ${pattern.source.replaceAll('\\/', '/')}`);
      }
      pattern.lastIndex = 0;
    });
  });

  const readmePath = path.join(root, 'README.md');

  if (!existsSync(readmePath)) {
    errors.push('README.md: file is required');
    return errors;
  }

  const readme = readFileSync(readmePath, 'utf8');
  const requiredTerms = ['http://localhost:3000', 'https://localhost:3001', 'backend:3002', 'postgres:5432', '`admin`', '`user`', 'TRP 3.2.1', 'IVMS101'];

  requiredTerms.forEach(term => {
    if (!readme.includes(term)) {
      errors.push(`README.md: missing canonical term ${term}`);
    }
  });

  return errors;
};

const validateDependencies = root => {
  const noticesPath = path.join(root, 'THIRD_PARTY_NOTICES');

  if (!existsSync(noticesPath)) {
    return ['THIRD_PARTY_NOTICES: file is required'];
  }

  const notices = readFileSync(noticesPath, 'utf8');
  const errors = [];

  ['backend/package.json', 'frontend/package.json'].forEach(manifestName => {
    const manifestPath = path.join(root, manifestName);

    if (!existsSync(manifestPath)) {
      return;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    Object.keys(manifest.dependencies || {})
      .sort()
      .forEach(dependency => {
        if (!notices.includes(`\`${dependency}\``)) {
          errors.push(`THIRD_PARTY_NOTICES: missing direct production dependency ${dependency}`);
        }
      });
  });

  return errors;
};

const validateMetadata = root => {
  const rootManifestPath = path.join(root, 'package.json');

  if (!existsSync(rootManifestPath)) {
    return ['package.json: file is required'];
  }

  const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
  const expectedEngines = JSON.stringify(rootManifest.engines);
  const expectedRepository = rootManifest.repository?.url;
  const errors = [];

  ['backend', 'frontend'].forEach(application => {
    const name = `${application}/package.json`;
    const manifestPath = path.join(root, name);

    if (!existsSync(manifestPath)) {
      errors.push(`${name}: file is required`);
      return;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    if (!rootManifest.engines || JSON.stringify(manifest.engines) !== expectedEngines) {
      errors.push(`${name}: engines must match package.json`);
    }

    if (expectedRepository && manifest.repository?.url !== expectedRepository) {
      errors.push(`${name}: repository URL must match package.json`);
    }

    if (expectedRepository && manifest.repository?.directory !== application) {
      errors.push(`${name}: repository directory must be ${application}`);
    }
  });

  return errors;
};

const run = ({ check, root }) => {
  const validators = {
    commands: validateCommands,
    dependencies: validateDependencies,
    env: validateEnvironment,
    format: validateFormat,
    links: validateLinks,
    metadata: validateMetadata,
    terminology: validateTerminology,
    workflows: validateWorkflows,
  };
  const selected = check === 'all' ? Object.keys(validators) : [check];
  const errors = selected.flatMap(name => validators[name](root));

  if (errors.length > 0) {
    errors.forEach(error => {
      process.stderr.write(`${error}\n`);
    });
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Documentation validation passed (${selected.join(', ')}).\n`);
};

try {
  run(parseArguments(process.argv.slice(2)));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
