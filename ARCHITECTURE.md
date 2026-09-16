# Architecture

## System boundary

Defy combines a Next.js 16 operator UI, an Express 5 authentication/compliance orchestration API, a native TRP 3.2.1 connector, PostgreSQL 17, and an Nginx gateway. IVMS101 is canonicalized as IVMS 101.2023 internally and emitted as IVMS 101.2020 on the TRP wire. The deployment represents one VASP; it does not custody assets or broadcast blockchain transactions.

```text
host browser
  -> 127.0.0.1:3000 Nginx
     -> frontend:3000 Next.js for /login, analytics, Travel Rule resources, /api-docs, /api-docs/reference, compliance cases, /users, and /configuration
     -> backend:3002 Express for /auth/* (including administrator /auth/manage/*)
     -> backend:3002 Express for /travel-rule/trp/inquiries*
     -> backend:3002 Express for anchored /travel-rule/trp/management*
     -> backend:3002 Express for /travel-rule/v1/cases*

custody/KYT integration
  -> backend:3002 scoped X-API-Key /travel-rule/v1 transfers, preflight, and webhooks

TRP peer
  -> 0.0.0.0:3001 Express TLS 1.3 listener
     -> root/health/identity allowlist
     -> mTLS /travel-rule/trp/protocol/* allowlist

backend:3002
  -> postgres:5432
  -> optional external SMTP
  -> outbound TLS 1.3/mTLS TRP peer
  -> HMAC-signed HTTPS integration webhooks
```

The local Compose contract exposes the UI, Auth, case review, inquiry review, and TRP management surface at `http://localhost:3000`, external TRP only at `https://localhost:3001`, the complete internal API only at `backend:3002`, and PostgreSQL only at `postgres:5432`. The browser UI has public `/login`; authenticated analytics, Travel Rule resource routes, integration guidance at `/api-docs`, and searchable endpoint reference at `/api-docs/reference`; role-gated `/compliance/cases`; and administrator `/users` and `/configuration`.

The four resource lists and inquiry queue filter in PostgreSQL before pagination; their safe projections and role guards are unchanged. Search is a bounded literal substring match, and resource-specific enum filters share predicates with each count query. Token status uses one cutoff for both queries and gives consumption precedence over expiry. Inquiry status cards remain global totals.

The inquiry queue places search, status, page size, and an icon refresh control in the list toolbar. Refresh retains the selected filters and reloads the queue and global status totals. UI errors, warnings, and informational notifications use the single themed Sonner toaster at the bottom right. Forms retain invalid-field indicators and focus the first invalid input; multi-field validation produces one toast with the error count and first error. Request owners suppress results after their context closes or a newer request replaces them. Persistent security warnings are dismissed when their context closes. Documentation, help, loading and empty states, confirmation dialogs, and generated credentials remain in the page or dialog. Alt+Escape dismisses the latest toast without moving focus out of an open modal; the close button announces this shortcut. A successful Update request shows a toast and closes the modal.

The authenticated account menu also offers an Update modal. On an explicit user submission, a separate browser Axios client sends only the entered email and a fixed project-update request to `https://api.getdefy.co/contact/create`. It sends no cookies, JWT, CSRF header, or automatic retry and uses a 30-second timeout. The public Defy contact service persists a contact request and triggers its existing notification; this repository does not maintain a mailing list or persist the submitted email. The gateway CSP permits that exact HTTPS origin in `connect-src`, alongside same-origin API calls. No backend proxy or public environment variable is added.

## Containers and Docker networks

| Service | Responsibility | Networks |
| --- | --- | --- |
| `gateway` | Nginx reverse proxy for the UI, `/auth/*`, compliance cases, JWT inquiry review, and anchored JWT management | `app` |
| `frontend` | Non-root Next.js standalone server | `app` |
| `backend` | Non-root internal HTTP and public TLS listeners | `app`, `data` |
| `postgres` | Persistent PostgreSQL 17 | internal `data` |
| `runtime-bootstrap` | Atomic local secret and certificate generation | no network |
| `admin-bootstrap` | Idempotent local administrator creation | internal `data` |

The `data` network is Docker-internal, so neither PostgreSQL nor the complete backend API is published to the host. The gateway binds `127.0.0.1:3000`; the TRP listener deliberately binds `0.0.0.0:3001` for external peers. Container images use digest-pinned Debian/glibc Node 24, PostgreSQL 17, and Nginx Alpine bases. Application runtime containers are non-root, multi-stage, read-only, and use bounded tmpfs mounts.

## Gateway boundary

Nginx routes `/auth/*`, only `/travel-rule/v1/cases(?:/.*)?`, only `/travel-rule/trp/inquiries(?:/.*)?`, only `/travel-rule/trp/management(?:/.*)?`, and exact `POST /travel-rule/trp/email-access/consume` traffic to `backend:3002`; every other gateway request goes to `frontend:3000`. Browser application API requests therefore use same-origin relative paths; there is no build-time public API URL. API-client transfer/webhook orchestration and TRP protocol routes are deliberately absent. Native Next.js uses server-only `BASE_URL` rewrites for the same paths. Nginx enforces a 1 MB request-body limit, 30-second upstream timeouts, CSP, frame/content-type/referrer/permissions headers, a global `no-referrer` policy, and access logs that record `$uri` without query values.

The gateway does not terminate or proxy the TRP peer protocol. TLS 1.3 and peer-certificate handling stay in the backend listener on port 3001.

## Dual backend listeners

Exact `PROTOCOL=TRP` creates two separate Express applications and servers:

- `PORT` selects the internal HTTP listener (`3002` in Compose). It mounts root, liveness/readiness/metrics, all `/auth/*`, JWT/OIDC case and inquiry review, API-client orchestration, identity, and protocol routes.
- `TRP_PORT` selects the external TLS 1.3 listener (`3001` in Compose). A method/path gate runs before body parsing, CORS, and routing.

The public gate accepts only:

- `GET /`
- `GET /health/live`
- `GET /health/ready`
- `GET /identity`
- `POST /travel-rule/trp/protocol/inquiries/:token`
- `POST /travel-rule/trp/protocol/resolutions/:token`
- `POST /travel-rule/trp/protocol/confirmations/:token`

Routing on the public application is strict and case-sensitive. Other methods, trailing slashes, case variants, metrics, Auth paths, JWT inquiry/management/case paths, and API-key orchestration paths receive the sanitized 404 response.

When `PROTOCOL` is not exactly `TRP`, the backend retains Auth-only compatibility: it creates one HTTP server on `PORT`, does not read TRP configuration, and does not mount TRP routes.

## TLS and mTLS trust boundary

The public server supports only TLS 1.3 and requests a client certificate. Root, health, and identity can complete without a client certificate. After the exact public method/path allowlist accepts a protocol POST, certificate authentication runs before JSON or URL-encoded body parsing; an unauthenticated peer therefore receives 401 even when its body is malformed or larger than the parser limit. The protocol router repeats the certificate guard as defense in depth, then requires the TRP headers:

```http
api-version: 3.2.1
request-identifier: <UUIDv4>
```

The local bootstrap CA signs both generated server and client certificates. This is useful only for development. A production VASP must mount independently managed server keys, an approved peer trust bundle, a client certificate/key for outbound delivery, and an identity certificate chain; certificate issuance, expiry monitoring, rotation, and revocation remain operator responsibilities.

Outbound TRP delivery requires HTTPS, TLS 1.3, approved CAs, the configured client certificate, timeout enforcement, DNS/public-address validation, address pinning, and no redirects. Protocol exchange, cancellation, settlement confirmation, webhook delivery, TRP state reconciliation, and re-encryption batches run through a one-second PostgreSQL-backed worker schedule. Jobs use transaction claims with leases/`SKIP LOCKED`, bounded attempts, exponential backoff with jitter, and terminal dead-letter states. The node still never broadcasts a blockchain transaction; custody reports settlement through the versioned API.

## Runtime bootstrap and persistent volumes

`runtime-bootstrap` has no network. It atomically produces a matched PostgreSQL/backend credential set plus local CA, server/client certificates, `JWT_KEY`, `SERVICE_API_KEY`, and a 32-byte TRP data-encryption key. Publication is coordinated through the `bootstrap-state` volume with a lease/fencing token so interrupted or concurrent jobs cannot publish mismatched cross-volume state. Valid existing state is reused; corrupt or mismatched state fails closed.

Named volumes preserve:

- `backend-secrets`: backend credentials, encryption material, and certificates
- `postgres-secrets`: the matching PostgreSQL password
- `bootstrap-state`: bootstrap publication coordination state
- `postgres-data`: PostgreSQL cluster data

On a fresh installation, `admin-bootstrap` creates `admin@getdefy.co` with role `admin` and password `defyadmin` only if the email is absent. It accepts an existing active default admin without changing its hash. When the new default is absent, it also preserves an active legacy `admin@defy.local` administrator without creating a second account or changing its password. Role and activity conflicts fail closed. These credentials and the generated PKI are local fixtures, not production defaults.

In exact TRP mode, startup decrypts the persisted `trp_configuration.service_api_key` before opening listeners. The bootstrap `SERVICE_API_KEY` creates that row only when absent; it never overwrites a rotated row. AES-256-GCM envelopes use version 2 plus `key_id`; legacy version-1 records use the explicitly configured legacy key. Unknown key IDs, malformed envelopes, or decryption failures fail closed. Administrator reveal is no-store; rotation commits encrypted configuration and secret-free action history before changing the in-memory guard, so the old compatibility key becomes invalid immediately.

The administrator Configuration Center has three independently loaded surfaces: a read-only Runtime Overview, Scoped API Clients, and the legacy compatibility Service API Key. `GET /auth/manage/configuration/runtime` projects only the already-loaded runtime mode, public identity, operational durations, email/OIDC enablement, and encryption key identifiers/counts. It never exposes secrets, certificate/filesystem paths, encrypted values, or OIDC provider details. Scoped clients use the existing digest-only credential store and support overlap rotation plus explicit per-credential revocation; the canonical legacy client UUID is represented only by the legacy card in the UI.

The keyring has one active key and zero or more retired keys. New writes always use the active ID. A persistent, single-active re-encryption job traverses a static encrypted-column allowlist in bounded batches, recovers stale leases, and conditionally replaces only the exact envelope it read. Retired keys remain required for old database records and backups until a verified restore/key-retirement gate is complete.

## Persistence and canonical bootstrap

A fresh `postgres-data` volume runs `backend/src/schemas/database.sql` once through PostgreSQL initialization. The schema contains Auth, error/action history, TRP compatibility, encrypted Travel Rule email jobs, API-client credentials, counterparties, transfers, compliance cases/reviews, policy decisions, protocol exchanges/messages/attempts, webhooks, outbox, audit chain, and re-encryption jobs. Before local-admin work, `admin-bootstrap` reads PostgreSQL catalog metadata and fails closed unless the canonical bootstrap metadata is present and legacy Auth metadata is absent.

Every backend startup validates the initialized database against the canonical schema before configuring email or opening a listener. There is no runtime migration or in-place schema-upgrade path, and validation fails closed for incompatible initialized volumes. Restore requires the exact repository revision and the verified SHA-256 of that revision's canonical `database.sql`; a changed release requires a new fresh installation. The restore and key-retirement gates are defined in [Backup, Restore, and Key Rotation Runbook](./docs/operations/backup-restore-key-rotation.md).

Auth user creation, password changes, and recovery resets use PostgreSQL transactions. Recovery reset locks and consumes one token row, preventing replay/concurrent use. Travel Rule and neutral orchestration writes use transactions, row locks, conditional updates, durable message state, per-client idempotency digests, and peer/request replay protection. `audit_events` is append-only at the application boundary and binds each aggregate event to its predecessor with SHA-256; case export recomputes the chain.

## Protocol-neutral domain and routing

`orchestration_transfers`, `compliance_cases`, and `protocol_exchanges` own independent state machines. `policy_decisions` stores the profile/action/reason/required-field snapshot and its input hash. `protocol_messages`, `delivery_attempts`, `outbox_jobs`, and `webhook_delivery_attempts` own wire/delivery history. The existing TRP tables remain a compatibility projection linked through native TRP exchange IDs.

Connector contracts expose config validation, discovery, outbound/inbound exchange, decisions, settlement confirmation, status normalization, and health. Routing considers only candidates that provide every required capability, in caller order. It does not automatically switch connector after PII disclosure. `native_trp` is runtime-supported. The Sumsub adapter is fixture-tested but intentionally unregistered until sandbox lifecycle and webhook evidence exists; direct GTR and TRISA are not implemented.

The two explicit policy profiles are `TR-MASAK-2025` and `EU-TFR-2024`. Both require fresh sourced fiat valuations and common party fields, fail closed on sanctions matches, return stable reason codes, and persist immutable snapshots. The integration owns trustworthy valuation, linked-transfer aggregation, identity provenance, and upstream KYT/sanctions signals.

## Authentication and session invalidation

- Public and rate-limited: `/auth/login`, `/auth/forgot`, `/auth/password`
- Active local JWT cookie or Bearer JWT: `/auth/me`, case/inquiry review, analytics, and permitted management reads
- Exact OIDC RS256 Bearer identity mapped to an existing active local user: the same JWT-authenticated surfaces, with database-owned authorization
- `admin` or `platform_admin`: `/auth/manage/*` and re-encryption administration
- Role-gated reviewer/approver/auditor access: compliance cases and audit export
- Hashed, scoped `X-API-Key`, with legacy service-key fallback: internal `/travel-rule/v1` integration routes
- Authorized mTLS client plus TRP 3.2.1 headers: external protocol routes

Local JWTs contain email and `session_version`. Middleware reloads the user and requires an active account and an exact version match. Password, role, activation, and deactivation changes increment the database version, revoking every older local JWT. OIDC tokens do not use local session versions, but the active flag and role are reloaded for every request. OIDC accepts only exact-issuer/audience RS256 tokens, same-origin HTTPS discovery/JWKS metadata, signature-use RSA keys, and the configured email claim.

Login preserves its legacy token response but also sets `defy_session` as `HttpOnly`, `Secure`, `SameSite=Strict` and `defy_csrf` as a readable cookie with the same lifetime. The frontend deliberately deletes the old `localStorage.authToken`, sends credentials on same-origin requests, restores through `/auth/me`, and sends `X-CSRF-Token` on cookie-authenticated mutations. Logout clears both cookies. Bearer clients bypass the cookie CSRF check because they do not rely on ambient browser credentials.

Roles are `platform_admin`, `integration_operator`, `compliance_reviewer`, `compliance_approver`, and `auditor`, with legacy `admin` and `user` retained for compatibility. Administrator guards accept `admin` and `platform_admin`. High-risk cases can require a reviewer record and a final approval by a different actor; optimistic case versions prevent lost updates.

## Database, readiness, and shutdown

The backend creates one PostgreSQL pool from `DATABASE_URL`, with configurable connection and query timeouts. A pool error listener records a sanitized operational error. `GET /health/live` confirms the process is running; `GET /health/ready` executes `SELECT 1` and returns 503 when PostgreSQL is unavailable.

`GET /health/metrics` on the internal listener exposes Prometheus text counters for outbox and TRP reconciliation outcomes; the gateway and public listener do not expose it. Compose health checks gate service ordering. SIGINT/SIGTERM stop listeners, clear cleanup/outbox scheduling, and close the pool. Container restart policies preserve the persistent volumes across ordinary restarts.

## CORS, proxy trust, and request logging

`CORS_ORIGINS` is an explicit comma-separated allowlist. Empty configuration installs no CORS middleware, which is correct for the same-origin gateway. The internal application trusts exactly one proxy hop because requests arrive through Nginx; the public TLS application trusts no proxy and receives the peer connection directly. These values are architecture invariants, not environment-controlled booleans.

Nginx forwards `Host`, `X-Forwarded-For`, `X-Forwarded-Host`, and `X-Forwarded-Proto` to the internal listener. The public listener ignores proxy headers for connection trust. Morgan/Winston and database error/audit boundaries remove body/query values, emails, secrets, tokens, keys, provider messages, and sensitive URL tokens before output or persistence. Expected client failures, including parser 4xx responses and allowlist/router 404 responses, are not persisted in the error table; unexpected 5xx failures produce one sanitized durable error record.

## Email modes

`EMAIL_MODE=disabled` is the Compose default. No transporter is created, so Auth requests work without email and mail functions are no-ops. Reset tokens may still be created for known users, but no recovery link is delivered.

Exact `EMAIL_MODE=smtp` requires `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS` or `EMAIL_PASS_FILE`, and a valid `FRONTEND_URL`. Startup verifies the SMTP transport and fails before listening if validation or verification fails. SMTP is external; the stack includes no mailbox service.

Direct outbound TRP transfers have an application-level email fallback that does not alter TRP 3.2.1 messages. After `TRP_EMAIL_FALLBACK_DELAY_MINUTES` (positive integer, default `30`), an administrator may create independent recipient invitations for nonterminal, unexpired transfers. Recipient addresses and unsent raw magic-link tokens are AES-256-GCM encrypted; only the unique SHA-256 token digest remains after SMTP acceptance. A one-second worker claims at most ten rows with `FOR UPDATE SKIP LOCKED`, recovers five-minute stale leases, retries at most five times with exponential backoff plus jitter, and deliberately provides at-least-once delivery across the SMTP-acceptance/database-commit uncertainty window. The 30-day token is single-use and exposes only a structured read-only transfer summary. Existing initialized volumes are not migrated or backfilled.

## Build and verification

Backend builds Babel output into `backend/dist/`. Frontend uses Next.js standalone output with `X-Powered-By` disabled. Dockerfiles copy only manifests, required source/configuration, production dependencies, and generated build output into final images.

Repository verification includes backend lint/format/Jest/build, mirrored frontend Jest/Testing Library coverage, frontend production build, documentation/env/link/command validation, isolated PostgreSQL/OpenSSL TRP e2e, Playwright analytics/resource/configuration desktop/mobile coverage, and the Ubuntu 24.04 Docker smoke suite. Every runnable shell block in README and the manual TRP runbook is linked to an Ubuntu CI quality/e2e/Docker operation; private-clone and external-SMTP examples are the only narrowly declared non-CI categories.

The Docker smoke suite hashes every generated backend runtime file and the PostgreSQL bootstrap password, plus a database-side SHA-256 digest of the persisted local-admin bcrypt hash. It also validates the encrypted configuration envelope, rotates to a temporary in-memory/file-only key, proves old/new behavior and restart persistence, and restores the bootstrap key before later checks. It never emits key, ciphertext, JWT, or private-key material.
