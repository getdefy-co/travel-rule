#!/usr/bin/env bash
set -Eeuo pipefail

repository_root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
project_name="defy-trp-smoke-${$}"
fixture_root=''
rotation_key_file=''
rotation_pending=0
user_jwt=''
user_jwt_file=''
compose=(docker compose --project-name "$project_name" --file "$repository_root/compose.yaml")
expected_runtime_files=(
  'backend/ca-cert.pem'
  'backend/ca-key.pem'
  'backend/client-cert.pem'
  'backend/client-key.pem'
  'backend/database-url'
  'backend/jwt-key'
  'backend/server-cert.pem'
  'backend/server-key.pem'
  'backend/service-api-key'
  'backend/trp-encryption-key'
  'postgres/password'
)

fail() {
  echo "Docker smoke failed: $1" >&2
  exit 1
}

cleanup() {
  if [[ "$rotation_pending" == '1' && -n "$user_jwt" ]]; then
    restore_bootstrap_service_key "$user_jwt" >/dev/null 2>&1 || true
  fi

  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true

  if [[ -n "$fixture_root" ]]; then
    rm -rf "$fixture_root"
  fi
}

assert_project_resources_absent() {
  local project_label="label=com.docker.compose.project=$project_name"
  local containers
  local networks
  local volumes

  containers=$(docker container ls --all --quiet --filter "$project_label") || return $?
  networks=$(docker network ls --quiet --filter "$project_label") || return $?
  volumes=$(docker volume ls --quiet --filter "$project_label") || return $?

  if [[ -n "$containers" || -n "$networks" || -n "$volumes" ]]; then
    echo 'Docker smoke teardown left project resources behind.' >&2
    return 1
  fi
}

clean_teardown() {
  "${compose[@]}" down --volumes --remove-orphans || return $?
  assert_project_resources_absent
}

copy_runtime_file() {
  "${compose[@]}" cp "runtime-bootstrap:/runtime/backend/current/$1" "$2" >/dev/null
}

copy_runtime_tree() {
  local destination=$1

  mkdir -p "$destination/backend" "$destination/postgres" || return $?
  "${compose[@]}" cp 'runtime-bootstrap:/runtime/backend/current/.' "$destination/backend" >/dev/null || return $?
  "${compose[@]}" cp 'runtime-bootstrap:/runtime/postgres/current/.' "$destination/postgres" >/dev/null || return $?
}

file_digest() {
  local digest_output
  local digest

  digest_output=$(openssl dgst -sha256 "$1") || return $?
  digest=${digest_output##* }
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$digest"
}

snapshot_runtime_material() {
  local destination=$1
  local actual_manifest
  local digest
  local expected_manifest
  local file

  copy_runtime_tree "$destination" || return $?
  expected_manifest=$(printf '%s\n' "${expected_runtime_files[@]}" | LC_ALL=C sort) || return $?
  actual_manifest=$(
    find "$destination" -type f -print | while IFS= read -r file; do
      printf '%s\n' "${file#"$destination"/}"
    done | LC_ALL=C sort
  ) || return $?

  if [[ -z "$actual_manifest" || "$actual_manifest" != "$expected_manifest" ]]; then
    echo 'Docker smoke failed: generated runtime material does not match the expected filename manifest.' >&2
    return 1
  fi

  while IFS= read -r file; do
    [[ -s "$destination/$file" ]] || {
      echo "Docker smoke failed: generated runtime file is empty: $file" >&2
      return 1
    }
    digest=$(file_digest "$destination/$file") || return $?
    printf '%s %s\n' "$file" "$digest"
  done <<<"$expected_manifest"
}

admin_password_hash_digest() {
  local digest

  digest=$("${compose[@]}" exec -T postgres psql \
    --username defy \
    --dbname defy_db \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --command="SELECT encode(digest(password, 'sha256'), 'hex') FROM auth_users WHERE email = 'admin@getdefy.co' AND role = 'admin' AND is_active = TRUE;" | tr -d '\r\n') || fail 'could not digest the local administrator password hash'

  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || fail 'local administrator password hash is missing or ambiguous'
  printf '%s' "$digest"
}

assert_persisted_material_unchanged() {
  local expected_runtime=$1
  local expected_admin=$2
  local actual_runtime=$3
  local actual_admin=$4
  local phase=$5

  [ "$actual_runtime" = "$expected_runtime" ] || {
    echo "Docker smoke failed: $phase changed generated runtime material." >&2
    return 1
  }
  [ "$actual_admin" = "$expected_admin" ] || {
    echo "Docker smoke failed: $phase changed the local administrator password hash." >&2
    return 1
  }
}

assert_unpublished() {
  local service=$1
  local port=$2
  local container_id
  local container_ids
  local published

  container_ids=$("${compose[@]}" ps --quiet "$service") || fail "could not resolve the $service container"
  [ -n "$container_ids" ] || fail "could not resolve the $service container"

  while IFS= read -r container_id; do
    [ -n "$container_id" ] || continue
    published=$(docker inspect --format "{{json (index .HostConfig.PortBindings \"${port}/tcp\")}}" "$container_id") || fail "could not inspect $service port $port"
    [[ -z "$published" || "$published" == 'null' ]] || fail "$service port $port is unexpectedly published as $published"
  done <<<"$container_ids"
}

api_login() {
  curl --fail --silent --show-error \
    --header 'Content-Type: application/json' \
    --data-binary @- \
    http://127.0.0.1:3000/auth/login <<'JSON'
{"email":"admin@getdefy.co","password":"defyadmin"}
JSON
}

protocol_request_status() {
  local certificate_mode=$1
  local protocol_url='https://127.0.0.1:3001/travel-rule/trp/protocol/resolutions/missing-token'
  local curl_arguments=(
    --silent
    --show-error
    --output /dev/null
    --write-out '%{http_code}'
    --cacert "$fixture_root/ca-cert.pem"
    --header 'Content-Type: application/json'
    --header 'api-version: 3.2.1'
    --header "request-identifier: $request_identifier"
    --data '{"rejected":null}'
  )

  if [[ "$certificate_mode" == 'with-certificate' ]]; then
    curl_arguments+=(--cert "$fixture_root/client-cert.pem" --key "$fixture_root/client-key.pem")
  fi

  curl "${curl_arguments[@]}" "$protocol_url"
}

public_route_status() {
  local method=$1
  local path=$2
  local body=${3-}
  local curl_arguments=(
    --silent
    --show-error
    --output /dev/null
    --write-out '%{http_code}'
    --cacert "$fixture_root/ca-cert.pem"
    --request "$method"
  )

  if (($# >= 3)); then
    curl_arguments+=(--header 'content-type: application/json' --data "$body")
  fi

  curl "${curl_arguments[@]}" "https://127.0.0.1:3001${path}"
}

assert_public_route_isolated() {
  local method=$1
  local path=$2
  local body=${3-}
  local status

  if (($# >= 3)); then
    status=$(public_route_status "$method" "$path" "$body") || return $?
  else
    status=$(public_route_status "$method" "$path") || return $?
  fi

  if [[ "$status" != '404' ]]; then
    echo "Docker smoke failed: public $method $path returned $status instead of 404." >&2
    return 1
  fi
}

extract_login_token() {
  node -e "let body=''; process.stdin.on('data', chunk => { body += chunk; }); process.stdin.on('end', () => { const parsed = JSON.parse(body); if (parsed.code !== 0 || typeof parsed.data !== 'string' || !parsed.data) process.exit(1); process.stdout.write(parsed.data); });"
}

assert_admin_profile() {
  local token=$1

  curl --fail --silent --show-error \
    --header "Authorization: Bearer $token" \
    http://127.0.0.1:3000/auth/me | node -e "let body=''; process.stdin.on('data', chunk => { body += chunk; }); process.stdin.on('end', () => { const parsed = JSON.parse(body); if (parsed.data?.email !== 'admin@getdefy.co' || parsed.data?.role !== 'admin') process.exit(1); });"
}

assert_encrypted_configuration_seeded() {
  local valid

  valid=$("${compose[@]}" exec -T postgres psql \
    --username defy \
    --dbname defy_db \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --command="SELECT COUNT(*) = 1 AND bool_and(value_encrypted->>'algorithm' = 'A256GCM' AND value_encrypted->>'version' = '2' AND value_encrypted->>'key_id' = 'primary' AND jsonb_typeof(value_encrypted->'ciphertext') = 'string' AND jsonb_typeof(value_encrypted->'iv') = 'string' AND jsonb_typeof(value_encrypted->'tag') = 'string' AND value_encrypted - ARRAY['algorithm', 'ciphertext', 'iv', 'key_id', 'tag', 'version'] = '{}'::jsonb) FROM trp_configuration WHERE name = 'service_api_key';" | tr -d '\r\n') || return $?

  [ "$valid" = 't' ]
}

create_management_rotation_fixture() {
  [[ -n "$fixture_root" && -d "$fixture_root" ]] || return 1
  rotation_key_file="$fixture_root/service-key-rotation"
  (umask 077 && openssl rand -hex 32 >"$rotation_key_file") || return $?
  chmod 0600 "$rotation_key_file"
}

copy_management_rotation_fixture() {
  [[ -n "$rotation_key_file" && -f "$rotation_key_file" ]] || return 1
  "${compose[@]}" exec -T backend node -e "const fs = require('node:fs'); let value = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { value += chunk; }); process.stdin.on('end', () => { if (!/^[0-9a-f]{64}\\n?$/.test(value)) process.exit(1); fs.writeFileSync('/tmp/defy-smoke-service-key-rotation', value.trim(), { mode: 0o600 }); });" <"$rotation_key_file" >/dev/null
}

create_normal_user_jwt_fixture() {
  user_jwt_file="$fixture_root/user-jwt"
  (umask 077 && "${compose[@]}" exec -T backend node --input-type=module - <<'NODE' >"$user_jwt_file"
import fs from 'node:fs';
import jsonwebtoken from 'jsonwebtoken';

const jwtKey = fs.readFileSync(process.env.JWT_KEY_FILE, 'utf8').trim();
const token = jsonwebtoken.sign({ email: 'docker-smoke-user@example.invalid', session_version: 0 }, jwtKey);
process.stdout.write(token);
NODE
  ) || return $?
  chmod 0600 "$user_jwt_file"
  [[ -s "$user_jwt_file" ]]
}

prepare_management_rotation() {
  local token=$1

  "${compose[@]}" exec -T -e "USER_JWT=$token" backend node --input-type=module - <<'NODE'
import fs from 'node:fs';
import jsonwebtoken from 'jsonwebtoken';

const gateway = 'http://gateway:8080';
const internal = 'http://127.0.0.1:3002';
const configurationPath = '/auth/manage/configuration/service-api-key';
const rotationPath = '/tmp/defy-smoke-service-key-rotation';
const originalKey = fs.readFileSync(process.env.SERVICE_API_KEY_FILE, 'utf8').trim();
const temporaryKey = fs.readFileSync(rotationPath, 'utf8').trim();

const request = async (origin, pathname, { body, key, method = 'GET', token } = {}) => {
  return fetch(`${origin}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(key ? { 'x-api-key': key } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
};
const assertStatus = (response, status, label) => {
  if (response.status !== status) throw new Error(`${label} returned ${response.status}`);
};

let response = await request(gateway, configurationPath, { token: process.env.USER_JWT });
assertStatus(response, 200, 'masked configuration');
const metadata = await response.json();
const expectedMask = `${originalKey.slice(0, 4)}${'*'.repeat(8)}${originalKey.slice(-4)}`;
if (metadata.configured !== true || metadata.masked !== expectedMask || metadata.masked === originalKey || 'api_key' in metadata) {
  throw new Error('masked configuration projection is invalid');
}

response = await request(gateway, `${configurationPath}/reveal`, { method: 'POST', token: process.env.USER_JWT });
assertStatus(response, 200, 'configuration reveal');
if (response.headers.get('cache-control') !== 'no-store') throw new Error('configuration reveal is cacheable');
const revealed = await response.json();
if (revealed.api_key !== originalKey) throw new Error('configuration reveal differs from bootstrap key');

response = await request(gateway, '/auth/manage/create', {
  body: { email: 'docker-smoke-user@example.invalid', role: 'user' },
  method: 'POST',
  token: process.env.USER_JWT,
});
assertStatus(response, 200, 'normal-user fixture creation');
const jwtKey = fs.readFileSync(process.env.JWT_KEY_FILE, 'utf8').trim();
const normalUserToken = jsonwebtoken.sign({ email: 'docker-smoke-user@example.invalid', session_version: 0 }, jwtKey);

response = await request(gateway, '/travel-rule/trp/management/analytics?range=7d', { token: normalUserToken });
assertStatus(response, 200, 'normal-user analytics');
const analytics = await response.json();
if (analytics.range_days !== 7 || !analytics.summary || !Array.isArray(analytics.trends)) throw new Error('analytics projection is invalid');
response = await request(gateway, '/travel-rule/trp/management/messages?page=1&limit=1', { token: normalUserToken });
assertStatus(response, 200, 'normal-user management list');
response = await request(gateway, configurationPath, { token: normalUserToken });
assertStatus(response, 403, 'normal-user configuration');
response = await request(gateway, '/travel-rule/trp/management/travel-addresses', {
  body: { beneficiary_reference: 'normal-user-forbidden' },
  method: 'POST',
  token: normalUserToken,
});
assertStatus(response, 403, 'normal-user management mutation');

response = await request(gateway, '/travel-rule/trp/management/travel-addresses', {
  body: { beneficiary_reference: 'admin-private-gateway' },
  method: 'POST',
  token: process.env.USER_JWT,
});
assertStatus(response, 201, 'admin private management mutation');

response = await request(gateway, configurationPath, {
  body: { api_key: temporaryKey },
  method: 'PUT',
  token: process.env.USER_JWT,
});
assertStatus(response, 200, 'configuration rotation');
const rotated = await response.json();
if ('api_key' in rotated) throw new Error('rotation response exposed the service key');

response = await request(internal, '/travel-rule/trp/travel-addresses', {
  body: { beneficiary_reference: 'rotated-old-key' },
  key: originalKey,
  method: 'POST',
});
assertStatus(response, 401, 'old orchestration key');
response = await request(internal, '/travel-rule/trp/travel-addresses', {
  body: { beneficiary_reference: 'rotated-new-key' },
  key: temporaryKey,
  method: 'POST',
});
assertStatus(response, 201, 'new orchestration key');
NODE
}

restore_bootstrap_service_key() {
  local token=$1

  "${compose[@]}" exec -T -e "USER_JWT=$token" backend node --input-type=module - <<'NODE'
import fs from 'node:fs';

const originalKey = fs.readFileSync(process.env.SERVICE_API_KEY_FILE, 'utf8').trim();
const response = await fetch('http://gateway:8080/auth/manage/configuration/service-api-key', {
  method: 'PUT',
  headers: { authorization: `Bearer ${process.env.USER_JWT}`, 'content-type': 'application/json' },
  body: JSON.stringify({ api_key: originalKey }),
});

if (response.status !== 200) throw new Error(`bootstrap key restore returned ${response.status}`);
NODE
}

assert_rotation_persisted_and_restore() {
  local token=$1

  "${compose[@]}" exec -T -e "USER_JWT=$token" backend node --input-type=module - <<'NODE'
import fs from 'node:fs';
import { Client } from 'pg';

const gateway = 'http://gateway:8080';
const internal = 'http://127.0.0.1:3002';
const configurationPath = '/auth/manage/configuration/service-api-key';
const originalKey = fs.readFileSync(process.env.SERVICE_API_KEY_FILE, 'utf8').trim();
const temporaryKey = fs.readFileSync('/tmp/defy-smoke-service-key-rotation', 'utf8').trim();
const requestAddress = (key, reference) => fetch(`${internal}/travel-rule/trp/travel-addresses`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': key },
  body: JSON.stringify({ beneficiary_reference: reference }),
});
const assertStatus = (response, status, label) => {
  if (response.status !== status) throw new Error(`${label} returned ${response.status}`);
};

let failure;
try {
  let response = await requestAddress(originalKey, 'restart-old-key');
  assertStatus(response, 401, 'restart old orchestration key');
  response = await requestAddress(temporaryKey, 'restart-new-key');
  assertStatus(response, 201, 'restart persisted orchestration key');

  const databaseUrl = fs.readFileSync(process.env.DATABASE_URL_FILE, 'utf8').trim();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query("SELECT data::text FROM auth_action_history WHERE action IN ('revealed_service_api_key', 'rotated_service_api_key')");
    const history = JSON.stringify(result.rows);
    if (history.includes(originalKey) || history.includes(temporaryKey)) throw new Error('action history contains a service key');
  } finally {
    await client.end();
  }
} catch (error) {
  failure = error;
}

try {
  const response = await fetch(`${gateway}${configurationPath}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${process.env.USER_JWT}`, 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: originalKey }),
  });
  assertStatus(response, 200, 'bootstrap key restore');
} catch (error) {
  failure ||= error;
}

if (!failure) {
  let response = await requestAddress(temporaryKey, 'restored-temporary-key');
  assertStatus(response, 401, 'restored temporary orchestration key');
  response = await requestAddress(originalKey, 'restored-bootstrap-key');
  assertStatus(response, 201, 'restored bootstrap orchestration key');
}

if (failure) throw new Error('service-key rotation acceptance failed');
NODE
}

assert_internal_api() {
  local token=$1

  "${compose[@]}" exec -T backend node --input-type=module - <<'NODE'
import fs from 'node:fs';

const apiKey = fs.readFileSync(process.env.SERVICE_API_KEY_FILE, 'utf8').trim();
const response = await fetch('http://127.0.0.1:3002/travel-rule/trp/travel-addresses', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
  body: JSON.stringify({ beneficiary_reference: 'docker-acceptance', ttl_seconds: 3600 }),
});
const body = await response.json();

if (response.status !== 201 || !body.id || !body.travel_address) {
  process.exit(1);
}

process.stdout.write(body.id);
NODE

  "${compose[@]}" exec -T -e "USER_JWT=$token" backend node --input-type=module - <<'NODE'
const response = await fetch('http://127.0.0.1:3002/travel-rule/trp/inquiries?page=1&limit=10', {
  headers: { authorization: `Bearer ${process.env.USER_JWT}` },
});
const body = await response.json();

if (!response.ok || !Array.isArray(body.data)) {
  process.exit(1);
}
NODE
}

assert_internal_transfer_persisted() {
  local transfer_id=$1

  "${compose[@]}" exec -T -e "TRANSFER_ID=$transfer_id" backend node --input-type=module - <<'NODE'
import fs from 'node:fs';

const apiKey = fs.readFileSync(process.env.SERVICE_API_KEY_FILE, 'utf8').trim();
const response = await fetch(`http://127.0.0.1:3002/travel-rule/trp/transfers/${process.env.TRANSFER_ID}`, {
  headers: { 'x-api-key': apiKey },
});
const body = await response.json();

if (!response.ok || body.id !== process.env.TRANSFER_ID) {
  process.exit(1);
}
NODE
}

assert_canonical_schema_failure() {
  local service
  local running_container

  "${compose[@]}" exec -T postgres psql \
    --username defy \
    --dbname defy_db \
    --set=ON_ERROR_STOP=1 \
    --command='ALTER TABLE orchestration_transfers DROP COLUMN operation_encrypted' || fail 'could not remove the disposable transfer-operation encryption fixture column'

  "${compose[@]}" down || fail 'could not stop the disposable stack while preserving its corrupted PostgreSQL volume'

  if "${compose[@]}" up --wait >/dev/null 2>&1; then
    fail 'fresh Compose startup accepted a database missing the required transfer operation-encryption column'
  fi

  for service in backend gateway; do
    running_container=$("${compose[@]}" ps --status running --quiet "$service") || fail "could not inspect $service after transfer operation-encryption schema rejection"
    [ -z "$running_container" ] || fail "$service remained available after transfer operation-encryption schema rejection"
  done
}

main() {
  trap cleanup EXIT HUP INT TERM

  command -v docker >/dev/null 2>&1 || fail 'docker is not installed'
  docker info >/dev/null 2>&1 || fail 'the Docker daemon is unavailable'
  docker compose version >/dev/null 2>&1 || fail 'Docker Compose is unavailable'

  cd "$repository_root"
  # docs-acceptance: stack-start
  "${compose[@]}" up --build --wait
  "${compose[@]}" ps >/dev/null

  # docs-acceptance: stack-lifecycle
  curl --fail --silent --show-error http://127.0.0.1:3000/login >/dev/null
  "${compose[@]}" ps >/dev/null
  "${compose[@]}" down
  "${compose[@]}" up --wait
  # docs-acceptance: fixture-export
  fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/defy-docker-smoke.XXXXXX") || fail 'could not create the Docker smoke fixture directory'
  copy_runtime_file ca-cert.pem "$fixture_root/ca-cert.pem"
  copy_runtime_file client-cert.pem "$fixture_root/client-cert.pem"
  copy_runtime_file client-key.pem "$fixture_root/client-key.pem"
  chmod 0600 "$fixture_root/client-key.pem"
  # docs-acceptance: readiness
  curl --fail --silent --show-error --cacert "$fixture_root/ca-cert.pem" https://127.0.0.1:3001/health/live >/dev/null
  curl --fail --silent --show-error --cacert "$fixture_root/ca-cert.pem" https://127.0.0.1:3001/health/ready >/dev/null

  # docs-acceptance: readiness-failure
  "${compose[@]}" stop postgres >/dev/null
  unavailable_status=$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' --cacert "$fixture_root/ca-cert.pem" https://127.0.0.1:3001/health/ready) || fail 'readiness request failed while PostgreSQL was stopped'
  [ "$unavailable_status" = '503' ] || fail "readiness without PostgreSQL returned $unavailable_status instead of 503"
  "${compose[@]}" start postgres >/dev/null
  "${compose[@]}" up --wait

  # docs-acceptance: admin-login-jwt
  user_jwt=$(api_login | extract_login_token) || fail 'default administrator API login failed'
  assert_admin_profile "$user_jwt" || fail 'default administrator profile check failed'
  assert_encrypted_configuration_seeded || fail 'service API key configuration is not stored as the canonical encrypted envelope'
  create_management_rotation_fixture || fail 'could not create the secure host rotation fixture'
  copy_management_rotation_fixture || fail 'could not copy the rotation fixture into the backend'
  rotation_pending=1
  prepare_management_rotation "$user_jwt" || fail 'management authorization or service-key rotation acceptance failed'
  create_normal_user_jwt_fixture || fail 'could not create the normal-user JWT fixture for backend restart acceptance'
  assert_public_route_isolated GET '/travel-rule/trp/management/analytics' || fail 'public management route isolation failed'
  "${compose[@]}" restart backend >/dev/null
  "${compose[@]}" up --wait
  copy_management_rotation_fixture || fail 'could not restore the rotation fixture after backend restart'
  assert_rotation_persisted_and_restore "$user_jwt" || fail 'service-key restart persistence or restore acceptance failed'
  rotation_pending=0
  rotation_pending=1
  PLAYWRIGHT_USER_TOKEN_FILE="$user_jwt_file" npm run test:e2e:frontend:docker
  restore_bootstrap_service_key "$user_jwt" || fail 'frontend acceptance did not restore the bootstrap service key'
  rotation_pending=0

  [ "$("${compose[@]}" port gateway 8080)" = '127.0.0.1:3000' ] || fail 'gateway binding differs from 127.0.0.1:3000'
  [ "$("${compose[@]}" port backend 3001)" = '0.0.0.0:3001' ] || fail 'TRP binding differs from 0.0.0.0:3001'
  assert_unpublished frontend 3000
  assert_unpublished backend 3002
  assert_unpublished postgres 5432

  # docs-acceptance: identity
  identity=$(curl --fail --silent --show-error --cacert "$fixture_root/ca-cert.pem" https://127.0.0.1:3001/identity) || fail 'public identity request failed'
  printf '%s' "$identity" | node -e "let body=''; process.stdin.on('data', chunk => { body += chunk; }); process.stdin.on('end', () => { const parsed = JSON.parse(body); if (parsed.lei !== 'DEFYLOCALVASP0000000' || parsed.name !== 'Defy Local Development VASP' || !parsed.x509?.includes('BEGIN CERTIFICATE')) process.exit(1); });" || fail 'public identity differs from the local contract'

  # docs-acceptance: public-404
  assert_public_route_isolated POST '/auth/login' '{}' || fail 'public auth route isolation failed'
  assert_public_route_isolated GET '/travel-rule/trp/inquiries' || fail 'public JWT inquiry route isolation failed'
  assert_public_route_isolated GET '/travel-rule/trp/management/analytics' || fail 'public JWT management route isolation failed'
  assert_public_route_isolated POST '/travel-rule/trp/travel-addresses' '{}' || fail 'public API-key route isolation failed'
  assert_public_route_isolated GET '/Identity' || fail 'public identity case isolation failed'
  assert_public_route_isolated GET '/identity/' || fail 'public identity trailing-slash isolation failed'
  assert_public_route_isolated POST '/travel-rule/trp/protocol/inquiries/missing-token/' '{}' || fail 'public protocol trailing-slash isolation failed'

  request_identifier='00000000-0000-4000-8000-000000000001'
  # docs-acceptance: no-cert-401
  no_certificate_status=$(protocol_request_status without-certificate) || fail 'protocol request without a client certificate failed'
  [ "$no_certificate_status" = '401' ] || fail "protocol request without a client certificate returned $no_certificate_status instead of 401"

  # docs-acceptance: trusted-mtls-404
  mtls_status=$(protocol_request_status with-certificate) || fail 'trusted mTLS protocol request failed'
  [ "$mtls_status" = '404' ] || fail "trusted mTLS request returned $mtls_status instead of reaching the token lookup"

  runtime_before=$(snapshot_runtime_material "$fixture_root/runtime-before") || fail 'could not snapshot initial runtime material'
  admin_hash_before=$(admin_password_hash_digest) || fail 'could not snapshot the initial administrator password hash'
  # docs-acceptance: bootstrap-idempotency
  "${compose[@]}" run --rm runtime-bootstrap >/dev/null
  "${compose[@]}" run --rm admin-bootstrap >/dev/null
  runtime_after_bootstrap=$(snapshot_runtime_material "$fixture_root/runtime-after-bootstrap") || fail 'could not snapshot runtime material after bootstrap rerun'
  admin_hash_after_bootstrap=$(admin_password_hash_digest) || fail 'could not snapshot the administrator password hash after bootstrap rerun'
  assert_persisted_material_unchanged "$runtime_before" "$admin_hash_before" "$runtime_after_bootstrap" "$admin_hash_after_bootstrap" 'bootstrap rerun' || exit 1

  # docs-acceptance: internal-api
  internal_transfer_id=$(assert_internal_api "$user_jwt") || fail 'internal API acceptance failed'
  [[ "$internal_transfer_id" =~ ^[0-9a-f-]{36}$ ]] || fail 'internal API returned an invalid transfer identifier'

  # docs-acceptance: restart-persistence
  "${compose[@]}" restart postgres backend frontend gateway >/dev/null
  "${compose[@]}" up --wait
  runtime_after_restart=$(snapshot_runtime_material "$fixture_root/runtime-after-restart") || fail 'could not snapshot runtime material after restart'
  admin_hash_after_restart=$(admin_password_hash_digest) || fail 'could not snapshot the administrator password hash after restart'
  assert_persisted_material_unchanged "$runtime_before" "$admin_hash_before" "$runtime_after_restart" "$admin_hash_after_restart" 'restart' || exit 1
  assert_admin_profile "$user_jwt" || fail 'restart invalidated the persisted administrator JWT'
  assert_internal_transfer_persisted "$internal_transfer_id" || fail 'restart did not preserve the internal transfer fixture'
  api_login | extract_login_token >/dev/null || fail 'restart did not preserve the local administrator'
  curl --fail --silent --show-error http://127.0.0.1:3000/login >/dev/null
  identity=$(curl --fail --silent --show-error --cacert "$fixture_root/ca-cert.pem" https://127.0.0.1:3001/identity) || fail 'public identity request failed after restart'
  printf '%s' "$identity" | node -e "let body=''; process.stdin.on('data', chunk => { body += chunk; }); process.stdin.on('end', () => { const parsed = JSON.parse(body); if (parsed.lei !== 'DEFYLOCALVASP0000000' || parsed.name !== 'Defy Local Development VASP' || !parsed.x509?.includes('BEGIN CERTIFICATE')) process.exit(1); });" || fail 'public identity differs from the local contract after restart'

  assert_canonical_schema_failure

  # docs-acceptance: cleanup
  "${compose[@]}" down
  clean_teardown
  rm -rf "$fixture_root"
  fixture_root=''
  trap - EXIT HUP INT TERM
  # docs-acceptance: full
  echo 'Docker smoke passed.'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
