# Travel Rule Protocol API

## Activation and listeners

The complete Travel Rule surface exists only when `PROTOCOL` is exactly `TRP`. Missing, lowercase, whitespace-suffixed, or unknown values keep Auth-only HTTP behavior on `PORT` and leave every TRP path at the global 404.

TRP mode creates two independent listeners:

| Configuration | Docker value | Contract |
| --- | --- | --- |
| `PORT` | `3002` | Internal HTTP at `backend:3002`; full Auth, identity, protocol, case/inquiry, and scoped API-client orchestration routes |
| `TRP_PORT` | `3001` | External TLS 1.3 at `https://localhost:3001`/`0.0.0.0:3001`; exact public allowlist only |

The UI gateway remains `http://localhost:3000`. Nginx exposes same-origin `/auth/*`, `/travel-rule/v1/cases*`, and anchored JWT-protected `/travel-rule/trp/inquiries*` and `/travel-rule/trp/management*` subtrees. It does not expose broad `/travel-rule/trp/`, API-client transfer/webhook orchestration, or the mTLS peer protocol.

`TRP_PUBLIC_BASE_URL` must be HTTPS and is encoded into generated Travel Addresses. Local Compose uses `https://127.0.0.1:3001`; a real VASP must use its production origin and a matching server certificate.

## External listener allowlist

The external application uses strict, case-sensitive routing and a method/path gate before CORS, parsing, and route dispatch. For an allowlisted protocol POST, mTLS authentication runs before body parsing; the protocol router repeats the same guard as defense in depth. Only these requests are reachable:

| Method | Exact path shape | Authentication | Success |
| --- | --- | --- | --- |
| GET | `/` | None | 200 service status |
| GET | `/health/live` | None | 200 process liveness |
| GET | `/health/ready` | None | 200 database readiness or 503 |
| GET | `/identity` | None | 200 `{ name, lei, x509 }` |
| POST | `/travel-rule/trp/protocol/inquiries/:token` | mTLS + TRP headers | 200 `{ "version": "3.2.1" }` |
| POST | `/travel-rule/trp/protocol/resolutions/:token` | mTLS + TRP headers | 204 |
| POST | `/travel-rule/trp/protocol/confirmations/:token` | mTLS + TRP headers | 204 |

All Auth routes, metrics, case/inquiry-review/management routes, API-key orchestration routes, unsupported methods, `OPTIONS`/`HEAD`, case variants, and trailing-slash variants return the sanitized HTTP 404 response on port 3001. Public root and both public health routes are Defy deployment extensions; TRP identity remains the protocol discovery exception.

## TLS and protocol authentication

The public server requires TLS 1.3 and requests a client certificate. Root, health, and identity are intentionally available without a certificate. Every protocol request requires a certificate authorized by `TRP_CLIENT_CA_PATH` plus:

```http
api-version: 3.2.1
request-identifier: <UUIDv4>
```

Unsupported `api-extensions` return 501. Invalid headers or bodies from an authenticated peer return 400. Invalid, expired, or already consumed path tokens return 404. A request without an authorized client certificate returns 401 before JSON or URL-encoded parsing, including when its body is malformed or oversized. Expected 4xx responses are not stored in the error table; unexpected 5xx failures produce one sanitized durable error record. Internal failures use the sanitized 500 response. Successful protocol responses echo `api-version` and `request-identifier`.

The same peer-certificate fingerprint plus `request-identifier` replays the durable prior response. A consumed token with a different identifier returns 404.

## Identity

`GET /identity` returns:

```json
{
  "name": "Defy Local Development VASP",
  "lei": "DEFYLOCALVASP0000000",
  "x509": "-----BEGIN CERTIFICATE-----..."
}
```

Those values describe the local Compose fixture. Production must set the legal VASP name, valid LEI, public origin, and certificate chain.

## Protocol bodies

Inquiry bodies contain `asset.dti`, a positive lowest-denomination digit-string `amount`, `callback`, and uppercase `IVMS101`. The service validates IVMS 101.2020 or 101.2023, canonicalizes to 101.2023 internally, and emits IVMS 101.2020 on the TRP 3.2.1 wire.

Resolution bodies contain exactly one of:

```json
{
  "approved": {
    "address": "payment-address",
    "callback": "https://peer.example/confirmations/token"
  }
}
```

```json
{
  "rejected": "reason"
}
```

Confirmation bodies contain exactly `txid` or `canceled`.

## Internal service orchestration API

These compatibility endpoints exist on `backend:3002` only and require `X-API-Key`. A scoped API-client key is checked by its SHA-256 digest, status, expiry, revocation, and required transfer scope. The persisted global service key remains a compatibility client and is compared in constant time. Missing, wrong, revoked, expired, different-length, and unconfigured keys return generic HTTP 401; missing scope returns generic 403.

| Method | Path | Contract |
| --- | --- | --- |
| POST | `/travel-rule/trp/travel-addresses` | `transfers:write`; `{ beneficiary_reference, ttl_seconds? }`; returns 201 with `id`, `travel_address`, `expires_at` |
| POST | `/travel-rule/trp/transfers` | `transfers:write`; `{ travel_address, asset: { dti }, amount, ivms101 }`; returns 200 delivered/pending or 202 retryable |
| GET | `/travel-rule/trp/transfers/:id` | `transfers:read`; transfer state plus decrypted operation result; excludes IVMS payload |
| POST | `/travel-rule/trp/transfers/:id/confirm` | `transfers:write`; exactly `{ txid }` or `{ canceled }`; returns 200 delivered or 202 retryable |
| POST | `/travel-rule/trp/transfers/:id/retry` | `transfers:write`; retries the latest eligible message; 409 when none exists |

The node never broadcasts an on-chain transaction.

## Inquiry review API

These endpoints exist on the internal `backend:3002` listener and are exposed through the loopback gateway at `http://localhost:3000`. They accept an active local JWT cookie/bearer or OIDC bearer mapped to a local user. Cookie decisions require CSRF. Inquiry review roles are `admin`, `platform_admin`, `compliance_reviewer`, `compliance_approver`, and compatibility `user`; `auditor` and `integration_operator` do not receive decrypted inquiry access.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/travel-rule/trp/inquiries` | Optional `status` and `search`; `page` defaults 1; `limit` defaults 10 and is capped at 100 |
| GET | `/travel-rule/trp/inquiries/:id` | Decrypted canonical IVMS 101.2023 for manual review |
| POST | `/travel-rule/trp/inquiries/:id/decision` | `{ decision: "approved", payment_address }` or `{ decision: "rejected", reason }` |

The list response is `{ data, total, page, limit }`. List items contain `id`, `state`, `asset_dti`, `amount`, `expires_at`, `created_at`, and `updated_at`; `asset_dti`, `amount`, and `expires_at` may be `null` before the peer inquiry arrives. The detail response adds transfer metadata, represents the asset as `{ dti } | null`, and returns decrypted canonical `ivms101: object | null`. A `null` IVMS payload is not eligible for a decision.

Inquiry `search` is trimmed, limited to 100 characters, and matches literal substrings of ID, asset DTI, or amount without case sensitivity. It combines with `status` and the inbound-only queue restriction before pagination; `total` is the matching count. Invalid search types or lengths return 400. The UI status cards retain their unfiltered totals.

A decision accepts exactly one of the documented payload shapes and returns `{ id, state, retryable }`. It stores `user_id`, encrypted actor email, and role in the event. Successful callback delivery returns 200. A durable decision with failed callback delivery returns 202 and `retryable: true`; browser clients cannot invoke the API-key-protected retry endpoint. A stale decision returns 409, after which clients should reload the detail and queue.

## Persistence and operations

IVMS101 payloads and operational values use AES-256-GCM envelopes. Version 2 carries `key_id`; the configured active/retired keyring keeps historical records readable and a resumable worker can re-encrypt them. Token plaintext is never stored. Access and error URLs redact protocol path tokens, while log/error persistence removes request bodies, query values, credentials, email, and provider details.

Outbound compatibility message creation is atomic with its transfer or decision. Successful peer response application is atomic with the related transfer transition/event. A crash-stale `pending` message becomes eligible for explicit retry after twice `TRP_HTTP_TIMEOUT_MS`; retry preserves its logical identifier and TRP `request-identifier`. Protocol-neutral exchanges additionally use the durable outbox worker and reconcile native TRP terminal state into transfer/case/exchange state plus signed webhooks.

Fresh installations use `backend/src/schemas/database.sql`. Every startup validates an initialized database against the canonical schema before opening listeners; it does not run migrations or in-place schema upgrades. Restore requires the exact repository revision and the verified SHA-256 of that revision's canonical `database.sql`; a changed release requires a new fresh installation. Cleanup uses a separate PostgreSQL advisory lock, runs at startup, and repeats every 24 hours. See [Backup, Restore, and Key Rotation Runbook](../operations/backup-restore-key-rotation.md).

See [Compliance Orchestration API](./orchestration-api.md) for the neutral transfer/case/exchange contract and [Manual TRP Testing](../manual-trp-testing.md) for Docker-based identity, public isolation, and mTLS commands.
## JWT management API

Authenticated active `admin`, `platform_admin`, `integration_operator`, `compliance_reviewer`, `compliance_approver`, `auditor`, and compatibility `user` roles may read `/travel-rule/trp/management/analytics` and paginated `/transfers`, `/messages`, `/tokens`, and `/events` collections/details. Missing/invalid/revoked authentication is 401. Collection responses are `{ data, total, page, limit }`; `total` is the filtered count. Projections omit token digests/plaintext, encrypted payloads/operations, bearer URLs, peer fingerprints, raw message bodies, and event metadata. PostgreSQL `BIGINT` event and actor-user identifiers are decimal JSON strings so browser clients retain exact values.

All collections accept `page` (default 1), `limit` (default 20, maximum 100), and a trimmed `search` of at most 100 characters. Search performs a case-insensitive literal substring match; `%` and `_` are literal characters, not SQL wildcards. Search and exact-match filters combine with AND before pagination and counting. Omit filters for all values; sending `all`, unknown keys, invalid enum values, or non-string search returns 400.

| Resource | Search fields | Additional query filters |
| --- | --- | --- |
| Transfers | `id`, `asset_dti`, `amount` | `direction`, `state` |
| Messages | `id`, `transfer_id`, `logical_identifier`, `request_identifier`, `status_code`, `error_code` | `direction`, `phase`, `delivery_state` |
| Tokens | `id`, `transfer_id` | `purpose`, `status` |
| Events | `id`, `transfer_id`, `actor_user_id`, `actor_role` | `event_type`, `from_state`, `to_state` |

Directions are `inbound|outbound`; `state`, `from_state`, and `to_state` accept `pending|approved|rejected|confirmed|canceled|expired`. Message phases and token purposes are `inquiry|resolution|confirmation`. Delivery states are `received|delivered|pending|failed`.

Token `status` accepts `active|consumed|expired`: consumed means `consumed_at IS NOT NULL` regardless of expiry; active means unconsumed with `expires_at` after the query cutoff; expired means unconsumed with `expires_at` at or before it. Both rows and total bind the same cutoff timestamp. Status is derived and adds no response field.

Event types are `created`, `inquiry_approved`, `inquiry_received`, `inquiry_rejected`, `manual_approval`, `manual_rejection`, `outbound_transfer_created`, `transfer_canceled`, `transfer_confirmed`, `transfer_expired`, and `travel_address_created`. A selected previous/next state excludes null states; omitting that filter includes them. Numeric IDs are searched as text without JavaScript number conversion.

### Analytics

`GET /travel-rule/trp/management/analytics` accepts `range=7d|30d|90d`; default is `30d`. Unsupported ranges return 400. The UTC interval contains the selected number of calendar days ending at the next UTC midnight.

| Field | Type | Contract |
| --- | --- | --- |
| `range_days` | integer | `7`, `30`, or `90` |
| `summary.transfers` | integer | Transfers created in range |
| `summary.pending_inquiries` | integer | Inbound pending transfers only; outbound pending excluded |
| `summary.confirmed_rate` | number | Confirmed transfers / transfers; zero when denominator is zero |
| `summary.delivery_rate` | number | Delivered messages / messages; zero when denominator is zero |
| `trends[]` | `{ day, direction, count }` | Every UTC day x `inbound|outbound`, zero-filled |
| `transfer_states[]` | `{ state, count }` | Transfer-state distribution |
| `message_states[]` | `{ phase, delivery_state, count }` | Phase x state distribution; delivery state includes real inbound `received` |
| `asset_amounts[]` | `{ id, asset_dti, amount }` | Per-transfer strings; amounts are not aggregated or coerced |

### Safe projections

Collection/detail fields are exact:

| Resource | Safe fields |
| --- | --- |
| Transfers | `id`, `protocol`, `direction`, `state`, `asset_dti`, `amount`, `expires_at`, `retention_until`, `created_at`, `updated_at` |
| Messages | `id`, `transfer_id`, `phase`, `direction`, `logical_identifier`, `request_identifier`, `delivery_state`, `status_code`, `error_code`, `superseded_by`, `created_at`, `delivered_at` |
| Tokens | `id`, `transfer_id`, `purpose`, `expires_at`, `consumed_at`, `created_at` |
| Events | decimal-string `id`, `transfer_id`, `event_type`, `from_state`, `to_state`, decimal-string/null `actor_user_id`, `actor_role`, `created_at` |

Transfer detail adds `email_enabled`, `email_fallback_available_at`, `actions: { can_confirm, can_cancel, can_email, can_retry }`, and chronological safe `events`; message detail adds `actions: { can_retry }`. `email_fallback_available_at` is the configured creation-time threshold for outbound transfers and `null` for inbound transfers. Token/event detail adds nothing. Missing detail is 404; malformed UUID/event BIGINT is 400.

Action booleans are server-derived snapshots. Confirm and cancel require an outbound approved transfer without an active confirmation delivery. Retry requires an unsuperseded outbound message to be failed or pending beyond twice `TRP_HTTP_TIMEOUT_MS`; the retry operation selects the latest eligible message. Mutation endpoints remain authoritative and may still return 409 if state changes after a detail read.

### Admin mutations

Only `admin` or `platform_admin` may mutate below `/travel-rule/trp/management`; other authenticated roles receive 403. Cookie mutations require CSRF. The bodies and statuses intentionally mirror existing service orchestration:

| Method/path | Body | Success/status |
| --- | --- | --- |
| POST `/management/travel-addresses` | `{ beneficiary_reference, ttl_seconds? }`; non-empty reference, TTL integer 1-2592000 (service default when omitted) | 201 `{ id, travel_address, expires_at }` |
| POST `/management/transfers` | `{ travel_address, asset: { dti }, amount, ivms101 }`; amount positive digit string | 200 delivered/pending result or 202 `{ retryable: true, ... }` |
| POST `/management/transfers/:id/confirm` | Exactly `{ txid: non-empty-string }` or `{ canceled: string|null }` | 200 result, 202 retryable delivery, or 409 stale/ineligible |
| POST `/management/transfers/:id/retry` | No body fields required | 200 delivered result, 202 still retryable, or 409 no eligible message |
| POST `/management/transfers/:id/email-invitations` | `{ recipient_email }`; trimmed, valid, no CR/LF, maximum 254 characters | 202 safe email-job projection; 409 when transfer eligibility changed; 429 after 10 creations per actor in 15 minutes; 503 when email is disabled |
| GET `/management/emails?page&limit&status` | Optional status: `queued`, `processing`, `failed`, `sent`, `dead_lettered`, `consumed`, or computed `expired` | 200 `{ data, page, limit, total }`; administrator-only |
| POST `/management/emails/:id/retry` | No body fields required | 202 requeued safe job; 409 unless an unexpired, eligible `dead_lettered` job retains its token; 503 when email is disabled |

Cancellation is not a separate route: it is confirmation with `{ "canceled": null }` or a string reason. The node never broadcasts blockchain transactions. Existing API-key orchestration and JWT inquiry-review contracts remain unchanged, and none of these JWT routes is reachable on public port 3001.

### Email fallback access

The fallback is an application notification channel and does not change TRP 3.2.1 protocol requests or responses. Only `admin` and `platform_admin` may create or retry jobs. Eligible transfers are outbound, unexpired, at least `TRP_EMAIL_FALLBACK_DELAY_MINUTES` old, and in `pending`, `approved`, or `rejected`. Every request creates an independent invitation; there is no transfer-level uniqueness constraint and no backfill.

Safe job projections contain `id`, `transfer_id`, decrypted `recipient_email`, effective `status`, `attempts`, `last_error_code`, `created_at`, `updated_at`, `sent_at`, `expires_at`, and `consumed_at`. A stored `sent` job is reported as `expired` after its 30-day expiry. Token plaintext/envelopes, digests, SMTP responses, and encrypted fields are never returned.

The recipient URL is `FRONTEND_URL/travel-rule/shared#token=...`. The frontend does not send the fragment until the recipient explicitly chooses **View transfer**, then removes the fragment and posts `{ token }` to exact same-origin `POST /travel-rule/trp/email-access/consume`. This public endpoint is limited to 10 requests per IP per 15 minutes. Invalid, expired, previously consumed, and terminal-transfer tokens all return the same HTTP 410 `{ "message": "Link unavailable." }`. Success atomically consumes the link and returns only transfer metadata plus originator/beneficiary names, accounts, country, and structured addresses—never raw IVMS101, identity/birth data, operation/message data, or email-job data. The endpoint is reachable through the loopback gateway but remains rejected by the external port 3001 allowlist.
