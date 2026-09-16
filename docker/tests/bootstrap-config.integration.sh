#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/defy-bootstrap-config-integration.XXXXXX")
postgres_root="$fixture_root/postgres"
backend_root="$fixture_root/backend"
state_root="$fixture_root/state"

cleanup() {
  rm -rf "$fixture_root"
}

trap cleanup EXIT HUP INT TERM

[ -f "$repository_root/backend/dist/config/runtime.js" ] || {
  echo 'bootstrap-config integration requires a backend build' >&2
  exit 1
}

mkdir -p "$postgres_root" "$backend_root" "$state_root"
POSTGRES_SECRETS_ROOT="$postgres_root" BACKEND_SECRETS_ROOT="$backend_root" BOOTSTRAP_STATE_ROOT="$state_root" BACKEND_RUNTIME_GID="$(id -g)" sh "$repository_root/docker/runtime-bootstrap.sh" >/dev/null

TASK4_BACKEND_ROOT="$backend_root/current" TASK4_REPOSITORY_ROOT="$repository_root" node <<'NODE'
const path = require('node:path');
const assert = require('node:assert/strict');

const repositoryRoot = process.env.TASK4_REPOSITORY_ROOT;
const secretRoot = process.env.TASK4_BACKEND_ROOT;
const { loadRuntimeConfig } = require(path.join(repositoryRoot, 'backend/dist/config/runtime'));
const config = loadRuntimeConfig({
  DATABASE_URL_FILE: path.join(secretRoot, 'database-url'),
  EMAIL_MODE: 'disabled',
  EMAIL_PASS_FILE: path.join(path.dirname(secretRoot), 'email_password'),
  JWT_KEY_FILE: path.join(secretRoot, 'jwt-key'),
  PORT: '3002',
  PROTOCOL: 'TRP',
  SERVICE_API_KEY_FILE: path.join(secretRoot, 'service-api-key'),
  TRP_CLIENT_CA_PATH: path.join(secretRoot, 'ca-cert.pem'),
  TRP_CLIENT_CERT_PATH: path.join(secretRoot, 'client-cert.pem'),
  TRP_CLIENT_KEY_PATH: path.join(secretRoot, 'client-key.pem'),
  TRP_DATA_ENCRYPTION_KEY_FILE: path.join(secretRoot, 'trp-encryption-key'),
  TRP_PORT: '3001',
  TRP_PUBLIC_BASE_URL: 'https://127.0.0.1:3001',
  TRP_SERVER_CA_PATH: path.join(secretRoot, 'ca-cert.pem'),
  TRP_SERVER_CERT_PATH: path.join(secretRoot, 'server-cert.pem'),
  TRP_SERVER_KEY_PATH: path.join(secretRoot, 'server-key.pem'),
  TRP_VASP_LEI: 'DEFYLOCALVASP0000000',
  TRP_VASP_NAME: 'Defy Local Development VASP',
});

assert.equal(config.port, 3002);
assert.equal(config.trpPort, 3001);
assert.equal(config.email.mode, 'disabled');
assert.equal(config.trp.lei, 'DEFYLOCALVASP0000000');
assert.equal(config.trp.encryptionKey.length, 32);
NODE

TASK4_REPOSITORY_ROOT="$repository_root" node <<'NODE'
const path = require('node:path');
const assert = require('node:assert/strict');

const repositoryRoot = process.env.TASK4_REPOSITORY_ROOT;
const { ensureLocalAdmin } = require(path.join(repositoryRoot, 'backend/dist/bootstrap/admin'));
const password = require(path.join(repositoryRoot, 'backend/dist/libs/password')).default;
let inserted;
const databasePool = {
  query: async (sql, params) => {
    if (sql.startsWith('SELECT')) {
      return { rows: [], rowCount: 0 };
    }

    inserted = params;
    return { rows: [{ role: 'admin', is_active: true }], rowCount: 1 };
  },
};

(async () => {
  assert.equal(await ensureLocalAdmin({ databasePool, hashPassword: password.hashPassword }), 'created');
  assert.deepEqual([inserted[0], inserted[2]], ['admin@getdefy.co', 'admin']);
  assert.equal(await password.comparePassword('defyadmin', inserted[1]), true);
})().catch(() => {
  process.exitCode = 1;
});
NODE

echo 'bootstrap/config/admin integration passed'
