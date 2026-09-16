# Docker Deployment

## Scope

`compose.yaml` is the supported Ubuntu 24.04 local full-stack runtime. It starts Nginx, Next.js, Express, PostgreSQL, an atomic runtime-secret bootstrap, and the local administrator bootstrap. It is also the Docker acceptance target in CI.

The unmodified Compose file is not a production VASP deployment because it intentionally generates a development CA/client pair, uses a synthetic identity, and documents a local administrator password. Production deployment requires reviewed overrides or an equivalent orchestrator configuration.

## Local service contract

| Service | Listener | Host publication |
| --- | --- | --- |
| `gateway` | `8080` | `127.0.0.1:3000` |
| `frontend` | `3000` | None |
| `backend` internal | `3002` | None |
| `backend` TRP | `3001` | `0.0.0.0:3001` |
| `postgres` | `5432` | None |

UI, Auth, JWT/OIDC compliance and inquiry review, and anchored JWT management use `http://localhost:3000`. External TRP uses `https://localhost:3001`. Scoped API-client transfer/webhook orchestration and internal metrics stay at `backend:3002`; database clients inside `data` use `postgres:5432`.

## Images and runtime users

Node 24 Debian/glibc, PostgreSQL 17, and Nginx image references are pinned by digest. Backend and frontend use multi-stage builds and run as the image's non-root `node` user. Nginx runs as `nginx`. Application containers have read-only roots with bounded writable tmpfs mounts.

Build and inspect the resolved Compose model:

```bash
docker compose config --quiet
docker compose build --pull
docker compose images
```

Digest pinning makes base updates explicit: update both tag and digest in a reviewed change, rebuild, run the complete acceptance suite, and inspect dependency/SBOM differences.

## Local persistence

Four named volumes are intentional:

- `postgres-data` stores the PostgreSQL cluster.
- `backend-secrets` stores backend credentials, PKI, and encryption material.
- `postgres-secrets` stores the matching PostgreSQL password.
- `bootstrap-state` coordinates crash-safe publication across both secret volumes.

An ordinary restart or `docker compose down` preserves all four. `docker compose down --volumes` deletes them and is therefore an irreversible reset for disposable local development data only. It permanently removes PostgreSQL and generated secrets; never run it for production or data that must be retained.

An initialized `postgres-data` volume is never reset or deleted. Canonical bootstrap metadata validation rejects incompatible schemas and startup does not upgrade them. Restore requires the exact repository revision and the verified SHA-256 of that revision's canonical `backend/src/schemas/database.sql`; a changed release requires a new fresh installation. Never automate volume removal as startup, upgrade, or recovery behavior.

Inspect volume names before any lifecycle operation:

```bash
docker compose ls
docker volume ls --filter 'label=com.docker.compose.project=defy-trp'
```

## Production replacement checklist

Before exposing a real VASP service:

1. Keep the repository private until the `ivms101@2.0.0` license gate is resolved.
2. Replace `runtime-bootstrap` with managed, access-controlled secret/certificate mounts.
3. Replace the synthetic LEI, development VASP name, and loopback public URL.
4. Mount a production server certificate/key, outbound client certificate/key, peer trust bundle, and server CA bundle with least privilege.
5. Generate independent high-entropy PostgreSQL, JWT, compatibility service API, per-client API, webhook, and AES-256-GCM keys; define rotation and recovery procedures.
6. Remove the local `admin-bootstrap`; provision named administrators through an approved process and rotate the documented local password if any local fixture remains.
7. Put the gateway behind the intended private operator-access boundary; do not broaden its host binding accidentally.
8. Expose port 3001 only through the approved network/firewall path for TRP peers.
9. Configure encrypted backups, point-in-time recovery, monitoring, alerts, log retention, certificate expiry monitoring, and incident response.
10. Record the exact repository revision and SHA-256 of its canonical `backend/src/schemas/database.sql` with each backup, then rehearse restore at that exact revision. Plan every changed release as a new fresh installation; in-place schema upgrades are unsupported.
11. Configure external SMTP only when recovery/welcome email is required.
12. Run secret scanning, dependency audits, SBOM generation, CodeQL, isolated e2e, and the Docker acceptance suite before release. CodeQL is skipped while the repository is private without an explicitly licensed GitHub Code Security/GHAS path; a skipped job does not satisfy this gate.

Do not reuse generated development PKI or `defyadmin` in a production override.

## Secrets and certificates

The backend supports file inputs for `DATABASE_URL`, `JWT_KEY`, `SERVICE_API_KEY`, `TRP_DATA_ENCRYPTION_KEY`, `TRP_DATA_ENCRYPTION_RETIRED_KEYS`, and `EMAIL_PASS`. A direct value and its `_FILE` counterpart are mutually exclusive. File contents are read at startup and must be non-empty. In exact TRP mode, `SERVICE_API_KEY` only seeds an absent encrypted database row. A rotated row wins after restart; malformed envelope metadata, an unknown `key_id`, decryption failure, or invalid decrypted content prevents listeners from opening. Replacing the bootstrap file does not rotate an initialized database.

`TRP_DATA_ENCRYPTION_ACTIVE_KEY_ID` names the active write key. `TRP_DATA_ENCRYPTION_RETIRED_KEYS` is a JSON object from key ID to base64-encoded 32-byte key; production should normally use its `_FILE` form. `TRP_DATA_ENCRYPTION_LEGACY_KEY_ID` identifies the key used for version-1 envelopes. Keep old keys available until re-encryption, restore rehearsal, old-backup retention, and independent read verification are all complete.

Optional OIDC requires both `OIDC_ISSUER` and `OIDC_AUDIENCE`; issuer must be HTTPS without a trailing slash. `OIDC_EMAIL_CLAIM` defaults to `email`. The backend fetches exact same-origin discovery/JWKS metadata and does not accept an identity that lacks an active local user/role mapping.

Production secret mounts should be read-only, owned for the non-root runtime user, excluded from image build contexts, and never written to logs or environment dumps. The TLS server certificate must match `TRP_PUBLIC_BASE_URL`. Peer CA changes require coordinated trust-rollover planning; replacing a file on disk does not hot-reload a running process.

## SMTP

The local default is `EMAIL_MODE=disabled`; it ignores the empty Compose placeholder secret and creates no transporter. Exact `EMAIL_MODE=smtp` requires `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, a password file, and `FRONTEND_URL`. Startup calls SMTP verification and fails before opening listeners when verification fails.

`TRP_EMAIL_FALLBACK_DELAY_MINUTES` is a positive integer and defaults to `30`. It gates administrator-created fallback invitations for eligible outbound direct TRP transfers. SMTP verification confirms transport connectivity/authentication but does not guarantee that a specific recipient or sender will later be accepted. The durable worker is at-least-once, so a crash after SMTP acceptance but before the database update can resend the same single-use link.

Use an absolute host path outside the repository:

```bash
export EMAIL_MODE='smtp'
export EMAIL_HOST='smtp.example.invalid'
export EMAIL_PORT='587'
export EMAIL_USER='no-reply@example.invalid'
export FRONTEND_URL='https://operators.example.invalid'
export SMTP_PASSWORD_FILE='/absolute/managed/path/smtp-password'
docker compose up --build --wait
```

The project includes no SMTP server or mailbox UI.

## Health, startup order, and shutdown

PostgreSQL readiness gates admin bootstrap. Successful runtime/admin bootstrap and healthy backend/frontend gate Nginx. The backend readiness endpoint performs a database query; liveness only checks the process.

```bash
docker compose up --wait
docker compose ps
docker compose logs --no-log-prefix --tail 100 backend gateway postgres
```

The backend handles SIGINT/SIGTERM by closing both listeners, clearing TRP cleanup/outbox scheduling, and ending the PostgreSQL pool. Compose uses bounded grace periods and `unless-stopped` for long-running services.

## Fresh-install schema contract

PostgreSQL executes `backend/src/schemas/database.sql` only while creating an empty `postgres-data` volume. It does not re-run initialization files on subsequent starts. Before local-admin work, `admin-bootstrap` reads only PostgreSQL catalog metadata and fails closed unless the canonical bootstrap schema is present.

Before opening listeners, every backend validates the initialized database against the canonical schema. It does not run migrations or perform in-place upgrades. For recovery, verify the backup's exact repository revision and the SHA-256 of that revision's canonical `database.sql` before restoring; a changed release must use a new fresh installation. Follow [Backup, Restore, and Key Rotation Runbook](./operations/backup-restore-key-rotation.md); no repository command automates a destructive reset.

## Acceptance

The automated suite builds the stack and validates health, canonical schema/encrypted configuration, compatibility admin/user authorization, private management/public isolation, and internal APIs. Unit/integration verification covers canonical-schema validation, scoped API clients, policy profiles, neutral orchestration, outbox/webhooks, OIDC, keyring/re-encryption, and compliance cases. Docker smoke rotates the compatibility key, proves old/new behavior and restart persistence, restores the bootstrap key in normal and failure cleanup, then runs legacy orchestration assertions. Playwright covers analytics, resources, desktop/mobile, and configuration. Key, ciphertext, JWT, and private-key values are not printed. The final destructive schema fixture runs only in the disposable smoke volume:

```bash
npm ci
npm run test:docker:smoke
```

CI runs this on Ubuntu 24.04 with Playwright Chromium. A local success is not a substitute for the required private-repository CI result. The repository does not yet perform a real encrypted backup/restore rehearsal, certificate-expiry alert test, or external interoperability/sandbox gate; these remain pilot release operations.
