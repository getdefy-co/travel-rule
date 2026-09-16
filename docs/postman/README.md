# Postman collection

The files in this directory provide importable, secret-free examples for the Auth login helper and all 47 operations shown in the in-app API reference:

- `defy-travel-rule.postman_collection.json`: Postman Collection v2.1
- `localhost.postman_environment.json`: local listener URLs and empty runtime values

The collection does not create infrastructure, credentials, certificates, peers, or webhook receivers. Its POST and DELETE requests change local application state. Do not run the entire collection as one indiscriminate Runner sequence: transfer approval, rejection, cancellation, confirmation, settlement, retries, email delivery, and re-encryption have mutually exclusive or state-dependent prerequisites.

## Import and listener boundaries

Import both JSON files into Postman and select **Defy Travel Rule - localhost** as the active environment. Start the local stack as described in the repository README before using the gateway or public listener.

The three base URLs intentionally reflect the runtime security boundary:

| Variable | Default | Use |
| --- | --- | --- |
| `gateway_url` | `http://localhost:3000` | Loopback UI, login, cases, inquiry review, email access, and approved management routes |
| `internal_url` | `http://localhost:3002` | Complete internal Auth/TRP/orchestration API when the backend is run natively on the host |
| `public_url` | `https://localhost:3001` | External TLS identity, health, and mTLS TRP protocol allowlist |

Docker Compose does not publish `backend:3002` to the host. Consequently, the imported `internal_url=http://localhost:3002` works only for a backend started natively with that host listener. With the supported Compose stack, run internal-only collection requests from an authorized client attached to the internal Docker network and change `internal_url` to `http://backend:3002` in that client's local environment. Do not publish port 3002 to make Postman Desktop reach it. The collection does not change any port exposure.

## Authentication and local secrets

All credential fields are empty and marked secret in the example environment. Keep their values in your local Postman environment; do not export or share a populated environment.

- For local JWT authentication, set `operator_email` and `operator_password`, then send **Authentication helper → Login and capture JWT**. The test script stores `response.data` in `jwt_token`. An OIDC user can instead paste an existing bearer token into `jwt_token`.
- For integration requests, put an existing API-client credential in `api_key`. Its scopes must match the request: `transfers:read`, `transfers:write`, or `webhooks:manage`. Credential creation and rotation are administrator operations outside this collection.
- `travel_address`, `protocol_token`, `email_access_token`, JWTs, API keys, and webhook signing secrets are bearer or credential material even when Postman does not infer that from their name. Keep them local and clear them after testing.
- The create-orchestration request generates `idempotency_key` and `valuation_as_of` together when the key is empty. Sending the request again without editing either value preserves the exact body and exercises the 200 replay path. To start a new operation, clear `idempotency_key`; the pre-request script creates a new key and replaces `valuation_as_of` with a fresh timestamp. Do not refresh only the timestamp under an existing key because the changed canonical payload correctly returns 409.
- Inquiry, resolution, and confirmation use separate `inquiry_request_identifier`, `resolution_request_identifier`, and `confirmation_request_identifier` variables. Each pre-request script creates its own UUID when that variable is empty and preserves it for a deliberate replay of the same operation. Clear the corresponding variable before sending a new message in that phase. Do not copy an identifier between phases; the backend enforces uniqueness across protocol messages.

The collection captures returned transfer, inquiry, case, webhook, management-resource, email-job, and version values into the active environment. Event identifiers are PostgreSQL `BIGINT` values represented as decimal JSON strings; the scripts preserve them as strings instead of converting them to JavaScript numbers.

## Local CA and mTLS in Postman

Export the generated development certificates using the commands in [Manual TRP Testing](../manual-trp-testing.md#export-development-certificates). The relevant files are `ca-cert.pem`, `client-cert.pem`, and `client-key.pem`. Never print, commit, or share the private key.

In Postman Desktop:

1. Open **Settings → Certificates → CA Certificates** and add `ca-cert.pem` as a CA certificate.
2. Add a client certificate for host `localhost`, port `3001`, using `client-cert.pem` and `client-key.pem`.
3. Keep **SSL certificate verification** enabled.
4. Use the **Public peer protocol** folder only with tokens issued for the matching purpose and trusted client certificate.

Every protocol POST sends exact `api-version: 3.2.1` and its operation-specific UUID `request-identifier`. Its post-response tests also require the same API version and echoed request identifier. The inquiry, resolution, and confirmation examples are independent protocol messages. A token is single-purpose, peer-bound, expires, and is consumed atomically, so a placeholder or previously used token will not make a successful sequence.

## Stateful scenarios

Use separate transfers for the approval and rejection branches.

For direct TRP approval and confirmation:

1. On the receiving node, create a Travel Address and keep the captured `inquiry_id` and `travel_address`.
2. On the sending node, create a TRP transfer with that Travel Address and keep `transfer_id`.
3. On the receiving node, inspect the inquiry and submit the approved decision example.
4. On the sending node, wait until the outbound transfer is approved, then send the confirmation example with exactly `txid`.

For rejection, create a fresh Travel Address and transfer, then replace the inquiry decision body with the rejection body shown in its request description. Do not send a confirmation for a rejected transfer. To cancel an approved outbound transfer, replace a confirmation body with exactly `{"canceled": null}` or a string reason; do not include `txid` at the same time.

For protocol-neutral orchestration, clear `idempotency_key` before the first send so the pre-request script creates a fresh key/timestamp pair. Leave both generated values unchanged to replay the exact request. Clear `idempotency_key` again before creating a different transfer. If policy returns `needs_information`, fetch the case, update only allowed information with the captured `case_version`, and re-fetch it. Case approval, rejection, and escalation are alternatives. A four-eyes approval can require distinct reviewer and approver identities. Settlement requires a `ready` transfer; cancellation is an alternative lifecycle action.

## Requests with external prerequisites

- **Retry transfer:** an unsuperseded outbound message must be `failed`, or remain `pending` beyond twice `TRP_HTTP_TIMEOUT_MS`. Otherwise the API returns 409.
- **Email invitation:** SMTP must be enabled and the outbound transfer must be unexpired, old enough for `TRP_EMAIL_FALLBACK_DELAY_MINUTES`, and in an eligible state. Email retry additionally requires an unexpired eligible `dead_lettered` job that still retains its token.
- **Email access:** paste the 43-character token from the URL fragment into `email_access_token`. Consumption is single-use and returns the same 410 response for invalid, expired, consumed, and terminal-transfer links.
- **Re-encryption:** replace the example `target_key_id` with the configured active key ID. Only one job may be active. Review [Backup, Restore, and Key Rotation](../operations/backup-restore-key-rotation.md) before starting it.
- **Counterparty preflight:** `native_trp` is the only registered runtime connector. The selected connector must be healthy and satisfy every requested capability.
- **Webhook subscription:** provide a reachable, SSRF-safe HTTPS `webhook_url` and a local 32–256 character `webhook_secret`. The receiver must verify the documented HMAC, timestamp, and delivery identifier contract before acknowledging with 2xx.

Each request has a post-response status assertion. JSON endpoints validate the required fields and types for their response family before saving any chained environment value. BIGINT identifiers must remain decimal strings. DELETE subscription and public resolution/confirmation require an empty 204 body; protocol responses additionally validate `api-version` and the echoed `request-identifier`. A failing assertion can indicate a legitimate state precondition such as 409, an unavailable dependency such as readiness 503, or a wrong credential; inspect the response and the relevant API reference before changing the expected status.

The canonical contracts remain [Auth API](../api/auth-api.md), [Compliance Orchestration API](../api/orchestration-api.md), and [TRP API](../api/trp-api.md).
