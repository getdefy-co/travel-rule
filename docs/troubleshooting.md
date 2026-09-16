# Troubleshooting

## Collect safe evidence

Start with service state and bounded logs:

```bash
docker compose ps
docker compose logs --no-log-prefix --tail 100 gateway frontend backend postgres runtime-bootstrap admin-bootstrap
```

Do not attach runtime secret files, certificates' private keys, JWTs, API keys, SMTP credentials, database dumps, request bodies, query values, Travel Addresses, or protocol token URLs to an issue. Use [Security Policy](../SECURITY.md) for anything that may expose a vulnerability or secret.

## Compose does not start

Validate Docker and the resolved model:

```bash
docker info
docker compose version
docker compose config --quiet
```

Common causes are an unavailable Docker daemon, insufficient memory/disk, ports 3000/3001 already in use, or a missing SMTP password file while `EMAIL_MODE=smtp`.

Inspect port ownership on Ubuntu:

```bash
ss --tcp --listening --numeric --process | grep -E ':(3000|3001)\b' || true
```

Do not change host bindings until you understand which security boundary they protect.

## Bootstrap fails

`runtime-bootstrap` fails closed when existing backend/PostgreSQL secret volumes are corrupt or contain mismatched database credentials. It does not overwrite valid state. `admin-bootstrap` fails when database metadata is not canonical, when `admin@getdefy.co` conflicts with a non-`admin` or inactive account, or when the new default is absent and the legacy `admin@defy.local` account has the same conflict. Exact-TRP backend startup also fails before listeners open when persisted service-key envelope metadata is malformed, the encryption key cannot decrypt it, or decrypted content is invalid.

Review only sanitized logs:

```bash
docker compose logs --no-log-prefix runtime-bootstrap admin-bootstrap
```

For disposable local data only, an explicitly approved `docker compose down --volumes` creates a fresh database and secret set on the next start. Back up and rehearse restore first when any data matters. The command permanently deletes the local PostgreSQL volume; startup never runs it, and it is never a production repair or in-place upgrade procedure.

## UI is unavailable

Check gateway and frontend health:

```bash
curl --silent --show-error --include http://localhost:3000/login
docker compose ps gateway frontend
docker compose logs --no-log-prefix --tail 100 gateway frontend
```

The gateway is intentionally bound to `127.0.0.1`. Remote browsers cannot reach it without an approved access layer. Browser API calls use same-origin `/auth/*` plus exact JWT inquiry/management prefixes. Native Next.js may set server-only `BASE_URL`; broad TRP and API-key paths remain excluded.

## Login fails

The local credential is `admin@getdefy.co` / `defyadmin` only for a fresh local Compose database. Bootstrap never restores that password after it has been changed. An existing volume with an active legacy `admin@defy.local` account keeps that account and password instead of creating the new default. Unknown, wrong-password, and inactive login all intentionally return generic HTTP 401.

Check database readiness without exposing user data:

```bash
curl --silent --show-error --include \
  --cacert /path/to/exported/development-ca-cert.pem \
  https://localhost:3001/health/ready
```

If an existing local admin was changed, use the configured recovery flow or an explicitly approved database/admin recovery procedure. Do not delete volumes merely to recover a needed account.

## Readiness is 503

Readiness performs `SELECT 1`. Inspect PostgreSQL health and connectivity:

```bash
docker compose ps postgres backend
docker compose logs --no-log-prefix --tail 100 postgres backend
docker compose exec -T postgres pg_isready --username defy --dbname defy_db
```

Connection and query timeout defaults are 5 seconds and can be changed with `DATABASE_CONNECTION_TIMEOUT_MS` and `DATABASE_QUERY_TIMEOUT_MS` for non-Compose deployments.

## Public TRP TLS fails

Verify that port 3001 is published and use the generated CA for local certificates:

```bash
docker compose port backend 3001
curl --silent --show-error --include \
  --cacert /path/to/exported/development-ca-cert.pem \
  https://localhost:3001/identity
```

The server requires TLS 1.3. Protocol paths additionally require a client certificate trusted by `TRP_CLIENT_CA_PATH`. An unauthenticated protocol request returns 401, while an unallowlisted path returns 404 before protocol authentication.

Certificate hostname/IP must match the requested URL and `TRP_PUBLIC_BASE_URL` must match the identity encoded in newly generated Travel Addresses. See [Manual TRP Testing](./manual-trp-testing.md).

## Auth or orchestration returns 404 on port 3001

This is expected. `https://localhost:3001` exposes only root, health, identity, and exact protocol POST routes. Browser Auth, JWT inquiry review, and JWT management use loopback `http://localhost:3000`. API-key orchestration remains internal at `backend:3002`.

## Forgot password sends no email

Compose defaults to `EMAIL_MODE=disabled`. The endpoint still returns generic HTTP 200 and known users receive a one-time token in the database, but no message is delivered. Set exact `EMAIL_MODE=smtp` with every required SMTP value and an external password file; startup verifies the connection and fails fast.

Do not add Mailpit or print recovery tokens as a workaround.

## Existing database is incompatible

Initialization SQL runs only for a fresh PostgreSQL volume. `admin-bootstrap` validates required extensions/tables, encrypted TRP configuration metadata, columns, constraints, indexes, and forbidden legacy Auth metadata. Backend startup validates the initialized database against the canonical schema and never resets, upgrades, or deletes an initialized volume. An incompatible schema prevents listeners from opening. Restore only with the exact repository revision and verified SHA-256 of that revision's canonical `database.sql`; a changed release requires a new fresh installation. Follow the [Backup, Restore, and Key Rotation Runbook](./operations/backup-restore-key-rotation.md); never remove shared or production data.

## Service API key behaves unexpectedly after restart

The generated/bootstrap `SERVICE_API_KEY` seeds only an absent database row. After rotation, the encrypted database value wins across restart; editing only the seed file does not replace it. Use an `admin` or `platform_admin` identity to inspect masked metadata, explicitly reveal with no-store handling, and rotate through the supported endpoint. Rotation invalidates the legacy compatibility key immediately. Prefer scoped per-client credentials for integrations. Never print ciphertext, reveal responses, key files, or action-history dumps; action history should contain only secret-free reveal/rotation metadata.

## Verification fails

Run the narrowest failing command, then the complete gate:

```bash
npm run verify:docs
npm run verify:backend
npm run verify:frontend
npm --prefix frontend run build
npm run verify
```

Docker acceptance additionally requires a running Docker daemon and Playwright Chromium:

```bash
npx playwright install chromium
npm run test:docker:smoke
```

Report commands actually run and their observed exit/output. Never claim Docker or e2e success when the required daemon, PostgreSQL, OpenSSL, or browser was unavailable.
