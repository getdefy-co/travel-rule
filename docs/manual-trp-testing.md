# Manual TRP Testing

This runbook validates the local Docker implementation of TRP 3.2.1 with the generated development CA/client material. Run commands from the repository root on Ubuntu 24.04. The IVMS101 model is exercised more deeply by the isolated backend e2e suite; this runbook focuses on runtime boundaries.

## Prerequisites

Install Docker Engine with the Compose plugin plus `curl` and `jq`. Do not use these development certificates, identity values, API key, administrator credentials, or generated Travel Addresses outside an isolated local environment.

Start the full stack:

<!-- command-acceptance: ci:docker:stack-start -->
```bash
docker compose up --build --wait
docker compose ps
```

Expected published addresses are:

- UI/auth: `http://localhost:3000`
- External TRP TLS: `https://localhost:3001`
- Internal backend: `backend:3002`
- Internal PostgreSQL: `postgres:5432`

## Export development certificates

The exited `runtime-bootstrap` container retains read-only access to the named secret volume. Copy only the CA and generated client material into a temporary directory, restrict its permissions, and keep the terminal session local:

<!-- command-acceptance: ci:docker:fixture-export -->
```bash
export TRP_FIXTURE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/defy-trp-manual.XXXXXX")
docker compose cp runtime-bootstrap:/runtime/backend/current/ca-cert.pem "$TRP_FIXTURE_DIR/ca-cert.pem"
docker compose cp runtime-bootstrap:/runtime/backend/current/client-cert.pem "$TRP_FIXTURE_DIR/client-cert.pem"
docker compose cp runtime-bootstrap:/runtime/backend/current/client-key.pem "$TRP_FIXTURE_DIR/client-key.pem"
chmod 0600 "$TRP_FIXTURE_DIR/client-key.pem"
```

Never print, commit, or share `client-key.pem`. The generated CA trusts only this local development fixture.

## Liveness, readiness, and identity

Public liveness and database-aware readiness do not require a client certificate:

<!-- command-acceptance: ci:docker:readiness -->
```bash
curl --fail --silent --show-error \
  --cacert "$TRP_FIXTURE_DIR/ca-cert.pem" \
  https://localhost:3001/health/live

curl --fail --silent --show-error \
  --cacert "$TRP_FIXTURE_DIR/ca-cert.pem" \
  https://localhost:3001/health/ready
```

Expected bodies are `{ "status": "live" }` and `{ "status": "ready" }`. Stop PostgreSQL to observe readiness return 503; restart it before continuing:

<!-- command-acceptance: ci:docker:readiness-failure -->
```bash
docker compose stop postgres
status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --cacert "$TRP_FIXTURE_DIR/ca-cert.pem" \
  https://localhost:3001/health/ready)
test "$status" = '503'
docker compose start postgres
docker compose up --wait
```

Inspect the local identity:

<!-- command-acceptance: ci:docker:identity -->
```bash
curl --fail --silent --show-error \
  --cacert "$TRP_FIXTURE_DIR/ca-cert.pem" \
  https://localhost:3001/identity | jq '{name, lei, has_certificate: (.x509 | startswith("-----BEGIN CERTIFICATE-----"))}'
```

Expected name is `Defy Local Development VASP`, synthetic LEI is `DEFYLOCALVASP0000000`, and `has_certificate` is true.

## Public route isolation

Auth, JWT inquiry, and API-key orchestration routes must remain unreachable on the public listener:

<!-- command-acceptance: ci:docker:public-404 -->
```bash
public_status() {
  local method=$1
  local path=$2
  local body=${3-}
  local curl_arguments=(
    --silent
    --show-error
    --output /dev/null
    --write-out '%{http_code}'
    --cacert "$TRP_FIXTURE_DIR/ca-cert.pem"
    --request "$method"
  )

  if (($# >= 3)); then
    curl_arguments+=(--header 'content-type: application/json' --data "$body")
  fi

  curl "${curl_arguments[@]}" "https://localhost:3001${path}"
}

test "$(public_status POST '/auth/login' '{}')" = '404'
test "$(public_status GET '/travel-rule/trp/inquiries')" = '404'
test "$(public_status GET '/travel-rule/trp/management/analytics')" = '404'
test "$(public_status POST '/travel-rule/trp/travel-addresses' '{}')" = '404'
```

Method, case, and trailing-slash variants are also excluded:

<!-- command-acceptance: ci:docker:public-404 -->
```bash
test "$(public_status GET '/Identity')" = '404'
test "$(public_status GET '/identity/')" = '404'
test "$(public_status POST '/travel-rule/trp/protocol/inquiries/missing-token/' '{}')" = '404'
```

## mTLS negative and positive checks

Use a syntactically valid TRP resolution and an intentionally missing token. Without a client certificate, the protocol guard returns 401:

<!-- command-acceptance: ci:docker:no-cert-401 -->
```bash
export REQUEST_IDENTIFIER='00000000-0000-4000-8000-000000000001'
export PROTOCOL_URL='https://localhost:3001/travel-rule/trp/protocol/resolutions/missing-token'

status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --cacert "$TRP_FIXTURE_DIR/ca-cert.pem" \
  --header 'api-version: 3.2.1' \
  --header "request-identifier: $REQUEST_IDENTIFIER" \
  --header 'content-type: application/json' \
  --data '{"rejected":null}' \
  "$PROTOCOL_URL")
test "$status" = '401'
```

The generated trusted client certificate passes mTLS and reaches token lookup, where the intentionally missing token returns 404:

<!-- command-acceptance: ci:docker:trusted-mtls-404 -->
```bash
status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --cacert "$TRP_FIXTURE_DIR/ca-cert.pem" \
  --cert "$TRP_FIXTURE_DIR/client-cert.pem" \
  --key "$TRP_FIXTURE_DIR/client-key.pem" \
  --header 'api-version: 3.2.1' \
  --header "request-identifier: $REQUEST_IDENTIFIER" \
  --header 'content-type: application/json' \
  --data '{"rejected":null}' \
  "$PROTOCOL_URL")
test "$status" = '404'
```

A complete inbound protocol success needs a live, unconsumed Travel Address token and a trusted HTTPS resolution callback. Use `npm --prefix backend run test:e2e` for that controlled two-VASP flow; do not paste bearer protocol URLs into logs or issue reports.

## Local admin login through the gateway

Authentication is available only through same-origin `http://localhost:3000/auth/*` from the host:

<!-- command-acceptance: ci:docker:admin-login-jwt -->
```bash
export LOGIN_RESPONSE=$(curl --fail --silent --show-error \
  --header 'content-type: application/json' \
  --data '{"email":"admin@getdefy.co","password":"defyadmin"}' \
  http://localhost:3000/auth/login)
export USER_JWT=$(printf '%s' "$LOGIN_RESPONSE" | jq -er '.data')
```

Do not print or persist `USER_JWT`. Confirm the user profile:

<!-- command-acceptance: ci:docker:admin-login-jwt -->
```bash
curl --fail --silent --show-error \
  --header "Authorization: Bearer $USER_JWT" \
  http://localhost:3000/auth/me | jq '.data | {email, role}'
```

Expected email is `admin@getdefy.co` and role is `admin`.

## Internal-network orchestration call

The host cannot connect directly to `backend:3002`. Run a one-off Node client inside the existing backend container. It reads the service API key from the mounted secret file without printing it and creates a local Travel Address:

<!-- command-acceptance: ci:docker:internal-api -->
```bash
docker compose exec -T backend node --input-type=module - <<'NODE'
import fs from 'node:fs';

const apiKey = fs.readFileSync(process.env.SERVICE_API_KEY_FILE, 'utf8').trim();
const response = await fetch('http://127.0.0.1:3002/travel-rule/trp/travel-addresses', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': apiKey,
  },
  body: JSON.stringify({ beneficiary_reference: 'manual-local-check', ttl_seconds: 3600 }),
});
const body = await response.json();

if (response.status !== 201 || !body.id || !body.travel_address) {
  throw new Error(`Unexpected orchestration response: ${response.status}`);
}

process.stdout.write(`${JSON.stringify({ id: body.id, status: response.status })}\n`);
NODE
```

Only the transfer id and status are printed; the Travel Address includes a bearer protocol token and stays undisclosed.

JWT inquiry review is exposed only on the loopback UI/auth listener. This example uses the internal backend network to list pending inquiries without printing the JWT:

<!-- command-acceptance: ci:docker:internal-api -->
```bash
docker compose exec -T -e USER_JWT="$USER_JWT" backend node --input-type=module - <<'NODE'
const response = await fetch('http://127.0.0.1:3002/travel-rule/trp/inquiries?page=1&limit=10', {
  headers: { authorization: `Bearer ${process.env.USER_JWT}` },
});
const body = await response.json();

if (!response.ok || !Array.isArray(body.data)) {
  throw new Error(`Unexpected inquiry response: ${response.status}`);
}

process.stdout.write(`${JSON.stringify({ count: body.data.length, page_count: body.page_count })}\n`);
NODE
```

Inquiry review roles are `admin`, `platform_admin`, `compliance_reviewer`, `compliance_approver`, and compatibility `user`. Only `admin` or `platform_admin` may use `/auth/manage/*`.

JWT management safe reads use the same loopback origin: a permitted active identity can call `GET /travel-rule/trp/management/analytics?range=7d`, while `admin` or `platform_admin` can call `GET /auth/manage/configuration/service-api-key` for `{ configured, masked, updated_at }`. Keep the Authorization value out of captured terminal output.

The second request requires `admin` or `platform_admin`. Reveal returns the full key with `Cache-Control: no-store`; do not pipe it to terminal output, shell history, or a file. Use the automated disposable smoke test for reveal/rotation/restart: it keeps values in container files or memory, verifies immediate invalidation/persistence, and restores the bootstrap key before later checks. Action history contains no key.

## Persistence and bootstrap idempotency

Restart the stateful services and verify identity/login again:

<!-- command-acceptance: ci:docker:restart-persistence -->
```bash
docker compose restart postgres backend frontend gateway
docker compose up --wait
curl --fail --silent --show-error http://localhost:3000/login >/dev/null
curl --fail --silent --show-error \
  --cacert "$TRP_FIXTURE_DIR/ca-cert.pem" \
  https://localhost:3001/identity >/dev/null
```

Rerunning the bootstrap jobs must not rotate the existing certificate or reset the admin password:

<!-- command-acceptance: ci:docker:bootstrap-idempotency -->
```bash
docker compose run --rm runtime-bootstrap
docker compose run --rm admin-bootstrap
```

The automated smoke suite compares SHA-256 digests for every generated runtime secret, key, and certificate plus the persisted local-admin bcrypt hash across both bootstrap reruns and service restart. It also validates encrypted configuration and temporary rotation/restart/restore without printing key or ciphertext material:

<!-- command-acceptance: ci:docker:full -->
```bash
npm run test:docker:smoke
```

## Cleanup

Remove only the exported temporary client material:

<!-- command-acceptance: ci:docker:cleanup -->
```bash
if [ -n "${TRP_FIXTURE_DIR:-}" ]; then
  rm -rf -- "$TRP_FIXTURE_DIR"
  unset TRP_FIXTURE_DIR
fi
unset LOGIN_RESPONSE USER_JWT REQUEST_IDENTIFIER PROTOCOL_URL
```

Stop containers while preserving named volumes:

<!-- command-acceptance: ci:docker:cleanup -->
```bash
docker compose down
```

Use `docker compose down --volumes` only when you explicitly approve permanent deletion of the local database and generated secrets.
