# Compliance Orchestration API Reference

## Scope and boundary

`/travel-rule/v1` is the protocol-neutral, single-VASP integration and compliance surface. It records transfer intent, evaluates a versioned policy profile, selects a connector by capability, drives durable protocol delivery, exposes reviewer decisions, and emits signed lifecycle webhooks. It does not custody assets, hold wallet private keys, broadcast blockchain transactions, or replace an upstream KYT/sanctions provider.

The API is mounted only when `PROTOCOL=TRP` is exact. API-client transfer routes remain internal on `backend:3002`; they are deliberately absent from the loopback browser gateway and the public TRP listener. Browser case routes are proxied through `http://localhost:3000`.

## Authentication and isolation

Integration routes require `X-API-Key`. New credentials are SHA-256 digests at rest, may expire, support overlap during rotation, and belong to one API client. Every transfer, idempotency key, and webhook subscription is isolated by that client ID. Supported scopes are:

| Scope | Operations |
| --- | --- |
| `transfers:read` | Transfer lookup and connector preflight |
| `transfers:write` | Create, complete information, cancel, and settle transfers |
| `webhooks:manage` | Create, list, and disable webhook subscriptions |

The legacy persisted service key remains a compatibility client with all three scopes. It should be retired after every integration has moved to scoped credentials.

Case and encryption-administration routes use an active local JWT cookie/bearer or an OIDC bearer identity mapped to an existing active Defy user. Cookie-authenticated mutations also require the double-submit CSRF token described in [Auth API](./auth-api.md).

## State model

| Aggregate | States |
| --- | --- |
| Transfer | `created`, `on_hold`, `ready`, `released`, `settled`, `returned`, `canceled` |
| Compliance case | `pending`, `needs_information`, `approved`, `rejected`, `escalated`, `expired` |
| Protocol exchange | `queued`, `delivering`, `awaiting_counterparty`, `completed`, `failed`, `dead_lettered`, `canceled` |

These states are independent. A completed exchange can remain `on_hold` until required compliance approval, and an approved case can remain `on_hold` until the exchange completes. Native TRP states are reconciled into these aggregates without changing the existing `/travel-rule/trp/*` contract.

## Create a transfer

### POST `/travel-rule/v1/transfers`

Required headers are `X-API-Key` and an `Idempotency-Key` containing 8–128 printable ASCII characters. The idempotency key is hashed and scoped to the authenticated API client. Concurrent identical requests create one aggregate and return 202 for the creator and 200 for an exact replay. Reusing the key with a different canonical request returns 409.

The strict JSON body accepts only:

| Field | Contract |
| --- | --- |
| `external_id` | Caller-owned identifier, 1–128 characters; unique per API client |
| `direction` | `inbound` or `outbound` |
| `policy_profile` | `TR-MASAK-2025` or `EU-TFR-2024` |
| `asset` | Positive integer-string `amount`, `code`, `network`, `is_stablecoin`; optional `dti` and `acquired_at` |
| `counterparty` | `type` is `hosted`, `unhosted`, or `unknown`; optional registry UUID and Travel Address |
| `parties` | Party information and provenance; native TRP candidates require `parties.ivms101` |
| `valuations` | Unique TRY/EUR/USD values with source and ISO timestamp; values must be no older than five minutes at evaluation |
| `risk_signals` | Bounded upstream signals containing `type` and boolean `matched` |
| `connector_candidates` | Ordered connector keys; currently runtime support is `native_trp` only |
| `required_capabilities` | One or more documented connector capabilities |
| `description` | 1–500 characters; the Türkiye profile requires at least 20 non-whitespace characters |
| `linked_totals` | Optional caller-calculated `try_amount`, `daily_usd`, and `monthly_usd` totals |
| `wallet_evidence` | Optional declaration/ownership evidence object |
| `first_withdrawal`, `travel_rule_applied` | Optional booleans used by the Türkiye profile |

`asset.amount` is a positive integer string in the caller’s canonical lowest denomination. Valuations are fiat values and are the policy threshold inputs. The caller is responsible for trustworthy decimal conversion, linked-transfer aggregation, valuation provenance, and freshness; Defy does not infer asset decimals or query a price feed.

A successful response is PII-free:

```json
{
  "id": "transfer-uuid",
  "state": "on_hold",
  "case": {
    "id": "case-uuid",
    "state": "needs_information",
    "action": "hold",
    "reason_codes": ["REQUIRED_DATA_MISSING"]
  },
  "exchange": {
    "id": "exchange-uuid",
    "connector": "native_trp",
    "state": "queued"
  }
}
```

When a case needs information, Defy may reserve the selected exchange but does not enqueue protocol delivery or disclose PII. A `case.action_required` webhook contains identifiers, reason codes, and required field names only.

## Transfer lifecycle

| Method and path | Scope | Behavior |
| --- | --- | --- |
| `GET /travel-rule/v1/transfers/:id` | `transfers:read` | Returns the owned PII-free transfer/case/exchange projection |
| `POST /travel-rule/v1/transfers/:id/information` | `transfers:write` | Merges approved mutable fields and re-evaluates policy using `expected_version` |
| `POST /travel-rule/v1/transfers/:id/cancel` | `transfers:write` | Cancels locally; queues remote cancellation only after PII disclosure or counterparty progress |
| `POST /travel-rule/v1/transfers/:id/settlement` | `transfers:write` | Accepts a printable `settlement_reference`, moves `ready` to `released`, and queues confirmation |

Information completion accepts `{ "expected_version": 0, "information": { ... } }`. Mutable fields are `description`, `first_withdrawal`, `linked_totals`, `parties`, `risk_signals`, `travel_rule_applied`, `valuations`, and `wallet_evidence`. A stale case version returns 409. Cancel and settlement are idempotent for the same terminal input and reject incompatible current state with 409.

## Connector preflight

### POST `/travel-rule/v1/counterparties/preflight`

Requires `transfers:read` and accepts only ordered `connector_candidates` and `required_capabilities`. It sends no party data. A healthy match returns `{ "available": true, "connector": "native_trp", "capabilities": [...], "health": ... }`; no match or an unhealthy connector returns `available: false` with a stable reason.

Capabilities are `async_callback`, `beneficiary_match`, `counterparty_discovery`, `ivms101_exchange`, `settlement_confirmation`, and `wallet_attestation`. The router selects the first candidate satisfying every mandatory capability. Automatic fallback after PII disclosure is disabled by default.

## Webhooks

| Method and path | Scope | Behavior |
| --- | --- | --- |
| `POST /travel-rule/v1/webhook-subscriptions` | `webhooks:manage` | Creates an HTTPS-only subscription with event list and 32–256 character secret |
| `GET /travel-rule/v1/webhook-subscriptions` | `webhooks:manage` | Lists safe metadata; URL and signing secret are never returned |
| `DELETE /travel-rule/v1/webhook-subscriptions/:id` | `webhooks:manage` | Disables an owned active subscription; returns 204 |

Events are `case.action_required`, `exchange.failed`, `transfer.ready`, `transfer.rejected`, and `transfer.settled`. Delivery uses the durable PostgreSQL outbox, five attempts, exponential backoff capped at five minutes, jitter, bounded HTTP timeout, SSRF-safe HTTPS resolution, and a dead-letter terminal state.

The JSON body is `{ "created_at", "data", "id", "type" }`. Defy sends:

- `X-Defy-Delivery`: stable delivery/job UUID
- `X-Defy-Event`: event type
- `X-Defy-Timestamp`: Unix seconds
- `X-Defy-Signature`: `v1=<lowercase hex HMAC-SHA256>`

The signature input is the exact UTF-8 string `<delivery-id>.<timestamp>.<raw-json-body>`. Consumers must use constant-time comparison, reject timestamps outside their replay window, persist delivery IDs before side effects, and return any 2xx status only after durable acceptance.

## Compliance cases and audit

| Method and path | Authentication | Behavior |
| --- | --- | --- |
| `GET /travel-rule/v1/cases` | Case-viewer JWT/OIDC | PII-free queue; filters `state`, `page`, and `limit` |
| `GET /travel-rule/v1/cases/:id` | Case-viewer JWT/OIDC | Current case, transfer, exchange, approval, and optimistic-lock version |
| `POST /travel-rule/v1/cases/:id/decisions` | Decision role + CSRF for cookie | Records `approved`, `rejected`, or `escalated` with reason and `expected_version` |
| `GET /travel-rule/v1/cases/:id/audit` | Case-viewer JWT/OIDC | Related append-only events plus recomputed `integrity` result |

Case viewers are `admin`, `platform_admin`, `compliance_reviewer`, `compliance_approver`, `auditor`, and compatibility `user`. Auditors cannot decide. `integration_operator` has no case access. Reviewer-stage decisions belong to `compliance_reviewer` or compatibility `user`; final approver-stage decisions belong to `compliance_approver`, `platform_admin`, or compatibility `admin`. A case requiring `compliance_approver` must have a different actor’s approved reviewer record before final approval.

Audit export contains hashes and operational metadata, not decrypted party data. `integrity: invalid` is an incident signal and must not be treated as a successful compliance evidence export.

## Encryption key rotation jobs

`POST /travel-rule/v1/encryption/reencryption-jobs` and `GET /travel-rule/v1/encryption/reencryption-jobs` require `admin` or `platform_admin`; creation also requires CSRF for cookie sessions. The requested `target_key_id` must equal the configured active key ID. Only one job may be active. The worker resumes stale processing leases, scans a static table/column allowlist in bounded batches, uses compare-before-update to preserve concurrent writes, and leaves retired keys readable until the job is verified complete.

See [Docker Deployment](../docker-deployment.md) and [Backup, Restore, and Key Rotation Runbook](../operations/backup-restore-key-rotation.md) before changing key material.

## Connector support status

`native_trp` is the only connector registered in the runtime. The Sumsub module implements official request signing, strict provider base URL checks, status normalization, webhook HMAC verification, and fixture-backed contract tests. It is intentionally not registered or advertised as supported until an approved sandbox supplies real credentials, lifecycle samples, webhook retries, and end-to-end mapping evidence. Direct Global GTR and native TRISA are not implemented.
