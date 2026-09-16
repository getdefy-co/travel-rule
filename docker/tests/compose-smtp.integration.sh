#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
compose_file="$repository_root/compose.yaml"
disabled_password_file="$repository_root/docker/secrets/email_password.disabled"
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/defy-compose-smtp.XXXXXX")
external_password_file="$fixture_root/smtp-password"

cleanup() {
  rm -rf "$fixture_root"
}

trap cleanup EXIT HUP INT TERM

[ -f "$repository_root/backend/dist/config/runtime.js" ] || {
  echo 'Compose SMTP integration requires a backend build' >&2
  exit 1
}

TASK4_COMPOSE_FILE="$compose_file" ruby <<'RUBY'
require 'yaml'

compose = YAML.safe_load_file(ENV.fetch('TASK4_COMPOSE_FILE'), aliases: false)
backend = compose.fetch('services').fetch('backend')
target = backend.fetch('environment').fetch('EMAIL_PASS_FILE')
mount = backend.fetch('secrets').find { |secret| secret.fetch('source') == 'smtp-password' }
source = compose.fetch('secrets').fetch('smtp-password').fetch('file')

raise 'unexpected SMTP secret target' unless target == '/run/secrets/email_password'
raise 'SMTP secret target and EMAIL_PASS_FILE differ' unless mount.fetch('target') == File.basename(target)
unless source == '${SMTP_PASSWORD_FILE:-./docker/secrets/email_password.disabled}'
  raise 'SMTP secret source is not externally configurable with a zero-config default'
end
RUBY

[ -f "$disabled_password_file" ] || {
  echo 'disabled SMTP password placeholder is missing' >&2
  exit 1
}
[ ! -s "$disabled_password_file" ] || {
  echo 'disabled SMTP password placeholder must be empty' >&2
  exit 1
}

printf '%s\n' 'external-smtp-password' >"$external_password_file"
chmod 0600 "$external_password_file"

TASK4_DISABLED_PASSWORD_FILE="$disabled_password_file" \
  SMTP_PASSWORD_FILE="$external_password_file" \
  TASK4_REPOSITORY_ROOT="$repository_root" \
  node <<'NODE'
const assert = require('node:assert/strict');
const path = require('node:path');

const repositoryRoot = process.env.TASK4_REPOSITORY_ROOT;
const { loadRuntimeConfig } = require(path.join(repositoryRoot, 'backend/dist/config/runtime'));
const baseEnvironment = {
  DATABASE_URL: 'postgres://defy:test@postgres:5432/defy_db',
  JWT_KEY: 'compose-smtp-integration-jwt-key',
  PORT: '3002',
};
const disabledConfig = loadRuntimeConfig({
  ...baseEnvironment,
  EMAIL_MODE: 'disabled',
  EMAIL_PASS_FILE: process.env.TASK4_DISABLED_PASSWORD_FILE,
});

assert.deepEqual(disabledConfig.email, { mode: 'disabled' });

const smtpConfig = loadRuntimeConfig({
  ...baseEnvironment,
  EMAIL_HOST: 'smtp.example.test',
  EMAIL_MODE: 'smtp',
  EMAIL_PASS_FILE: process.env.SMTP_PASSWORD_FILE,
  EMAIL_PORT: '587',
  EMAIL_USER: 'no-reply@example.test',
  FRONTEND_URL: 'https://app.example.test',
});

assert.deepEqual(smtpConfig.email, {
  frontendUrl: 'https://app.example.test',
  host: 'smtp.example.test',
  mode: 'smtp',
  password: 'external-smtp-password',
  port: 587,
  secure: false,
  user: 'no-reply@example.test',
});
NODE

echo 'Compose disabled and external-file SMTP wiring passed'
