# Auth API Reference

## Overview

The API exposes 19 authentication, user-management, service-configuration, and API-client credential endpoints under `/auth`. In the Docker runtime, browser clients call them through the same-origin gateway at `http://localhost:3000/auth/*`; no browser-visible API base URL is configured. Nginx forwards those paths to the complete internal API at `backend:3002`. For native development without Nginx, the Next.js server can proxy the same paths to the server-only `BASE_URL` origin.

The external TRP TLS listener at `https://localhost:3001` does not expose Auth, JWT inquiry, management, or API-key orchestration routes. Those requests, alternate methods, case variants, and trailing-slash variants remain outside its exact allowlist and return:

```json
{
  "code": 404,
  "message": "Not Found"
}
```

Successful handlers generally return:

```json
{
  "code": 0,
  "message": "OK",
  "data": null
}
```

Validation and authentication errors contain a `message` and may omit `code`.

Common status classes are:

| Status | Meaning |
| --- | --- |
| 200 | Successful Auth operation, including generic forgot-password acknowledgement |
| 400 | Validation, state conflict, or invalid/expired/used recovery token |
| 401 | Missing/invalid/revoked authentication or generic login failure |
| 403 | Authenticated user lacks the exact required role |
| 404 | Path is not mounted on the selected listener |
| 429 | Login or password-recovery rate limit exceeded |
| 500 | Sanitized internal failure; no provider, SQL, or secret detail is returned |

## Authentication and Roles

Protected endpoints accept a local bearer token for non-browser compatibility:

```http
Authorization: Bearer <jwt-token>
```

Browser login additionally sets `defy_session` as `HttpOnly`, `Secure`, `SameSite=Strict` and `defy_csrf` as a readable `Secure`, `SameSite=Strict` cookie. Both use path `/` and a 24-hour maximum age. Browser requests send credentials automatically. Cookie-authenticated mutations must copy the `defy_csrf` value into `X-CSRF-Token`; mismatch or absence returns HTTP 403 `CSRF validation failed.` Logout clears both cookies. The frontend removes the retired `localStorage.authToken` key during session restoration and logout.

The JWT middleware verifies a local token, loads its user by email, requires `is_active = true`, and requires the signed `session_version` to match the user's current database value. Password, role, activation, and deactivation changes increment that value and revoke every previously issued local JWT.

Optional OIDC is enabled only when `OIDC_ISSUER` and `OIDC_AUDIENCE` are both configured. Bearer verification accepts only RS256, exact issuer/audience, HTTPS same-origin discovery/JWKS metadata, and the configured email claim. That email must match an existing active Defy user; the database role, never a token role claim, controls authorization. OIDC is bearer-only in this MVP; there is no browser authorization-code login flow. OIDC tokens do not contain local `session_version`, but deactivation and role changes take effect on their next request because the user row is always reloaded.

Roles are:

| Role | Access |
| --- | --- |
| `platform_admin` | All `/auth/manage/*`, re-encryption administration, and full compatibility management |
| `integration_operator` | Authenticated self-service and integration-oriented safe management views; no case decisions |
| `compliance_reviewer` | Case queue/read and reviewer-stage decisions |
| `compliance_approver` | Case queue/read and approver-stage decisions |
| `auditor` | Read-only case/audit and safe management projections |
| `admin` | Compatibility administrator; same administrator guards as `platform_admin` |
| `user` | Compatibility user; self-service plus legacy inquiry/reviewer behavior |

`super_admin` is unsupported and does not grant management access.

### Service API key configuration

The bootstrap `SERVICE_API_KEY` is required startup seed input but creates only an absent encrypted `trp_configuration` row during exact-TRP startup. Startup then decrypts that row and uses its value as the compatibility service credential; after initialization and rotation, the persisted row wins. Version-2 AES-256-GCM envelopes include `key_id` and use the configured active/retired keyring. Unsupported metadata, an unknown key ID, decryption failure, or an invalid decrypted key prevents startup. Administrator JWT management is the only browser surface for compatibility configuration. Reveal and rotation action-history rows never contain the key.

New integrations should use per-client credentials created below. Defy stores only SHA-256 digests, applies scopes/expiry/revocation on every request, and permits overlapping credentials during rotation. The legacy service key maps to one fixed compatibility client with every integration scope.

Password, role, activation, and deactivation changes increment `session_version`. A token issued before any of those mutations fails the next protected request with generic HTTP 401; clients must sign in again.

Common protected-endpoint errors:

| Status | Condition                          | Message                  |
| ------ | ---------------------------------- | ------------------------ |
| 401    | Missing Authorization header       | `Token is required.`     |
| 401    | Invalid Bearer form or empty token | `Invalid token.`         |
| 401    | Verification/user/activity failure | `Authentication failed.` |
| 403    | Non-administrator management request | `Access denied.`       |

## Rate Limits

| Endpoint(s)                           | Window     | Maximum |
| ------------------------------------- | ---------- | ------- |
| `POST /auth/login`                    | 15 minutes | 10      |
| `POST /auth/forgot`, `/auth/password` | 15 minutes | 5       |

A rate-limit response is HTTP 429 and contains the configured generic message.

## Endpoints

### POST `/auth/login`

Authenticate an active user.

**Authentication:** Public, rate-limited.

**Body:**

| Field      | Type   | Required | Validation       |
| ---------- | ------ | -------- | ---------------- |
| `email`    | string | Yes      | Valid email      |
| `password` | string | Yes      | 8-72 UTF-8 bytes |

**Success (200):** `data` remains a signed JWT string for bearer compatibility. The two session/CSRF cookies described above are also set; browser code must not persist `data`.

```json
{
  "code": 0,
  "message": "OK",
  "data": "<jwt-token>"
}
```

Unknown users, wrong passwords, and inactive users all return the generic HTTP 401 `{ "message": "Authentication failed." }` response. Login writes a fully redacted-token action-history record.

### POST `/auth/logout`

Clear the local session and CSRF cookies.

**Authentication:** Active local cookie/JWT or OIDC bearer. Cookie requests require the CSRF header.

**Success (200):** standard response with `data: null`. The endpoint does not revoke all other sessions; password/role/activity changes remain the global local-JWT invalidation mechanism.

### GET `/auth/me`

Return the authenticated user's public profile.

**Authentication:** Active local cookie/JWT or OIDC bearer.

**Success (200):**

```json
{
  "code": 0,
  "message": "OK",
  "data": {
    "email": "user@example.invalid",
    "role": "user",
    "created_at": "2026-01-01T00:00:00.000Z"
  }
}
```

The response has no `key` or `apikey` field.

### POST `/auth/reset`

Change the authenticated user's password.

**Authentication:** Active local cookie/JWT or OIDC bearer. Cookie requests require CSRF.

**Body:**

| Field          | Type   | Required | Validation                                    |
| -------------- | ------ | -------- | --------------------------------------------- |
| `old_password` | string | Yes      | 8-72 UTF-8 bytes; must match current password |
| `new_password` | string | Yes      | 8-72 UTF-8 bytes and different from old       |

**Success (200):** standard response with `data: null`. The password and audit mutations commit in one database transaction and revoke all existing sessions, including the JWT used for this request.

Wrong current password returns HTTP 400 with `Old password is not valid.`

### POST `/auth/forgot`

Create a one-time reset token and send a password-recovery email.

**Authentication:** Public, rate-limited.

**Body:**

| Field   | Type   | Required | Validation  |
| ------- | ------ | -------- | ----------- |
| `email` | string | Yes      | Valid email |

`platform` is no longer part of the contract. If a client still sends it, it cannot select a different frontend; every link uses `FRONTEND_URL`. Known and unknown email addresses receive the same status and response body; unknown addresses produce no token, email, or audit side effect.

With Compose's default `EMAIL_MODE=disabled`, a known user still receives the same response and a recovery token is created, but no email is delivered. Exact `EMAIL_MODE=smtp` is required for delivery and is verified at startup.

**Success (200):**

```json
{
  "code": 0,
  "message": "If the email is registered, you will receive password reset instructions.",
  "data": null
}
```

### POST `/auth/password`

Set a password using a recovery token.

**Authentication:** Public, rate-limited.

**Body:**

| Field      | Type   | Required | Validation            |
| ---------- | ------ | -------- | --------------------- |
| `token`    | string | Yes      | Exactly 32 characters |
| `password` | string | Yes      | 8-72 UTF-8 bytes      |

Invalid, expired, or used tokens return HTTP 400 with `Invalid token.`, `Token expired.`, or `Token already used.` respectively. Reset tokens are stored and looked up only as SHA-256 digests. Success locks and consumes the token, updates the bcrypt hash, increments `session_version`, and writes action history in one transaction before returning the standard 200 response.

## Admin Management

Every route below requires an active local JWT cookie/bearer or OIDC bearer and the `admin` or `platform_admin` role. Mutations require CSRF for cookie sessions. User lists are global; there is no tenant or API-key filter.

### POST `/auth/manage/create`

Create a user with any supported role, then send a welcome link backed by a one-time reset token when SMTP is enabled. User, token-digest, and audit mutations commit in one database transaction before optional email delivery.

**Body:**

| Field   | Type   | Required | Validation                      |
| ------- | ------ | -------- | ------------------------------- |
| `email` | string | Yes      | Valid, unique email             |
| `role`  | string | No       | Any supported role; default `user` |

`key` and `apikey` are not request fields and are never persisted. A duplicate email returns HTTP 400 with `{ "code": 400, "message": "User already exists" }`.

**Success (200):** standard response with `data: null`.

### GET `/auth/manage/list`

List every user globally.

**Query:**

| Field    | Type    | Default | Validation                   |
| -------- | ------- | ------- | ---------------------------- |
| `page`   | integer | `1`     | At least 1                   |
| `limit`  | integer | `10`    | Between 1 and 100            |
| `search` | string  | `""`    | Case-insensitive email match |

**Success (200):**

```json
{
  "code": 0,
  "message": "OK",
  "data": [
    {
      "email": "user@example.invalid",
      "role": "user",
      "active": true,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  ],
  "page_count": 1
}
```

The response contains no tenant, company, `key`, or `apikey` field.

### POST `/auth/manage/activate`

Activate an existing inactive user.

**Body:** `{ "email": "user@example.invalid" }`

Missing users return `User not found.` and already-active users return `User is already activated.` with HTTP 400. Success returns the standard 200 response, writes action history, and revokes previously issued sessions.

### POST `/auth/manage/deactivate`

Deactivate an existing active user.

**Body:** `{ "email": "user@example.invalid" }`

Missing users return `User not found.` and already-inactive users return `User is already deactivated.` with HTTP 400. Success returns the standard 200 response, writes action history, and revokes previously issued sessions.

### POST `/auth/manage/edit`

Change an existing user's supported role.

**Body:**

| Field   | Type   | Required | Validation           |
| ------- | ------ | -------- | -------------------- |
| `email` | string | Yes      | Existing valid email |
| `role`  | string | No       | Any supported role   |

`super_admin` is rejected as `Invalid role.` `key` and `apikey` are not editable fields. Success returns the standard 200 response, writes action history, and revokes previously issued sessions when a role is supplied.

### GET `/auth/manage/configuration/runtime`

Return a read-only, secret-free projection of configuration already loaded by the running process. The handler does not reread environment variables, secret files, certificates, or persisted configuration.

**Success in exact TRP mode (200):**

```json
{
  "mode": "trp",
  "identity": {
    "name": "Example VASP",
    "lei": "00000000000000000000",
    "public_base_url": "https://trp.example.invalid:3001"
  },
  "operations": {
    "retention_days": 1825,
    "token_ttl_seconds": 86400,
    "http_timeout_ms": 10000,
    "email_fallback_delay_minutes": 30
  },
  "integrations": {
    "email_mode": "disabled",
    "oidc_enabled": false
  },
  "encryption": {
    "active_key_id": "primary",
    "retired_key_count": 0
  }
}
```

In Auth-only mode, `mode` is `auth`; `identity`, `operations`, and `encryption` are `null`; and the safe `integrations` booleans/mode remain available. The response never includes service/JWT/encryption/SMTP secrets, certificate or filesystem paths, OIDC issuer/audience/claim details, or encrypted values.

### GET `/auth/manage/configuration/service-api-key`

Return a safe administrator projection. The key is never returned.

**Success (200):**

```json
{
  "configured": true,
  "masked": "abcd********wxyz",
  "updated_at": "2026-01-01T00:00:00.000Z"
}
```

| Field | Type | Contract |
| --- | --- | --- |
| `configured` | boolean | True when the active key has been loaded from the encrypted persisted row |
| `masked` | string or null | First 4 characters, exactly 8 asterisks, last 4 characters; null only when unconfigured |
| `updated_at` | timestamp string or null | Persisted row update time |

### POST `/auth/manage/configuration/service-api-key/reveal`

Explicitly reveal the current key. Success always sets `Cache-Control: no-store`.

**Success (200):** `{ "api_key": "<full-service-key>", "updated_at": "2026-01-01T00:00:00.000Z" }`

The response is administrator-only and clients must not persist it. Success writes `revealed_service_api_key` action history with update metadata but without the key.

### PUT `/auth/manage/configuration/service-api-key`

Rotate the persisted and active orchestration credential.

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `api_key` | string | Yes | 32-256 printable non-whitespace ASCII characters (`0x21`-`0x7E`) |

**Success (200):** the same safe `{ configured, masked, updated_at }` projection as GET. The new encrypted row and secret-free `rotated_service_api_key` action-history record commit atomically before the in-memory guard changes. The old key receives generic 401 immediately after success; the encrypted persisted key remains active after restart. Validation returns 400, non-admin returns 403, and sanitized persistence failure returns 500 without key material.

## Scoped API Clients

All routes in this section require `admin` or `platform_admin`; mutations require CSRF for cookie sessions. API keys are returned exactly once on create/rotation and are never listable or recoverable later.

### POST `/auth/manage/api-clients`

Create an active client and first credential atomically.

| Field | Contract |
| --- | --- |
| `name` | Unique lowercase integration name matching `[a-z0-9][a-z0-9._-]{2,63}` |
| `scopes` | Unique non-empty subset of `transfers:read`, `transfers:write`, `webhooks:manage` |
| `expires_at` | Optional future ISO timestamp or null |

**Success (201):** client safe metadata plus one-time `api_key`. Credential/audit persistence commits before the key is returned.

### GET `/auth/manage/api-clients`

Returns `{ "data": [...] }` with client ID/name/scopes/status/created time and credential ID/created/expiry/revocation metadata. It never returns a digest or key.

### POST `/auth/manage/api-clients/:clientId/credentials`

Creates an overlapping credential for an active client. Body accepts only optional future `expires_at`. Success is 201 with `credentialId`, `expiresAt`, and one-time `api_key`. The prior credential remains valid until separately revoked or expired.

### DELETE `/auth/manage/api-clients/:clientId/credentials/:credentialId`

Revokes exactly one owned active credential and returns 204. Unknown/already-revoked targets return 404. Rotation safety requires creating and deploying the new credential before revoking the old one.

## Health Check

### GET `/`

Public and not rate-limited on `backend:3002` and `https://localhost:3001`. `http://localhost:3000/` is the protected Next.js UI, not this JSON endpoint.

```json
{
  "message": "Services are OK.",
  "code": 0
}
```

### GET `/health/live`

Returns HTTP 200 `{ "status": "live" }` when the process is running. It is available on both backend listeners, but not through the UI gateway.

### GET `/health/ready`

Executes `SELECT 1`. It returns HTTP 200 `{ "status": "ready" }` while PostgreSQL is reachable, or HTTP 503 `{ "status": "not-ready" }` otherwise. Compose uses the internal form for dependency ordering.

### GET `/health/metrics`

Internal-only Prometheus text exposition for durable outbox and native TRP reconciliation counters. It is not proxied by the loopback gateway and is rejected by the public TLS allowlist. Production access control belongs at the internal network/scrape boundary.

## Service API-Key Guard

`isAuthenticatedWithServiceApiKey` is not used by any `/auth/*` route. It protects the protocol-neutral integration routes documented in [Compliance Orchestration API](./orchestration-api.md) and the legacy TRP orchestration routes documented in [TRP API](./trp-api.md), using:

```http
X-API-Key: <service-key>
```

The guard first hashes this header and checks active/unexpired/unrevoked scoped API-client credentials. It then falls back to constant-time comparison with the persisted compatibility key. `SERVICE_API_KEY` supplies that fallback only when it seeds an absent row at startup; it does not override a rotated row. Missing, wrong, revoked, expired, different-length, or unconfigured credentials all return the same HTTP 401 `{ "message": "Authentication failed." }` response. Missing scope returns generic HTTP 403 `Access denied.`

## Endpoint Summary

| #   | Method | Path                      | Authentication      | Paginated |
| --- | ------ | ------------------------- | ------------------- | --------- |
| 1   | POST   | `/auth/login`             | Public + rate limit | No        |
| 2   | POST   | `/auth/logout`            | Active identity + CSRF for cookie | No |
| 3   | GET    | `/auth/me`                | Active identity     | No        |
| 4   | POST   | `/auth/reset`             | Active identity + CSRF for cookie | No |
| 5   | POST   | `/auth/forgot`            | Public + rate limit | No        |
| 6   | POST   | `/auth/password`          | Public + rate limit | No        |
| 7   | POST   | `/auth/manage/create`     | Administrator       | No        |
| 8   | GET    | `/auth/manage/list`       | Administrator       | Yes       |
| 9   | POST   | `/auth/manage/activate`   | Administrator       | No        |
| 10  | POST   | `/auth/manage/deactivate` | Administrator       | No        |
| 11  | POST   | `/auth/manage/edit`       | Administrator       | No        |
| 12  | GET    | `/auth/manage/configuration/runtime` | Administrator | No |
| 13  | GET    | `/auth/manage/configuration/service-api-key` | Administrator | No |
| 14  | POST   | `/auth/manage/configuration/service-api-key/reveal` | Administrator | No |
| 15  | PUT    | `/auth/manage/configuration/service-api-key` | Administrator | No |
| 16  | POST   | `/auth/manage/api-clients` | Administrator | No |
| 17  | GET    | `/auth/manage/api-clients` | Administrator | No |
| 18  | POST   | `/auth/manage/api-clients/:clientId/credentials` | Administrator | No |
| 19  | DELETE | `/auth/manage/api-clients/:clientId/credentials/:credentialId` | Administrator | No |
