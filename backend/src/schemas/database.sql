-- Database: defy_db (DATABASE_URL)
-- Fresh-install schema for the Auth API and optional Travel Rule Protocol node.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE error_logs (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    function_name TEXT,
    message TEXT,
    url TEXT,
    details JSONB,
    status TEXT
);

CREATE TABLE auth_users (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'platform_admin', 'integration_operator', 'compliance_reviewer', 'compliance_approver', 'auditor')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    session_version INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth_reset_password_tokens (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id BIGINT NOT NULL REFERENCES auth_users(id),
    token_digest BYTEA UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 day',
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth_action_history (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id BIGINT NOT NULL REFERENCES auth_users(id),
    action TEXT NOT NULL DEFAULT 'default',
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE trp_configuration (
    name TEXT PRIMARY KEY CHECK (name = 'service_api_key'),
    value_encrypted JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE travel_rule_transfers (
    id UUID PRIMARY KEY,
    protocol TEXT NOT NULL CHECK (protocol = 'TRP'),
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    state TEXT NOT NULL CHECK (state IN ('pending', 'approved', 'rejected', 'confirmed', 'canceled', 'expired')),
    asset_dti TEXT,
    amount TEXT,
    payload_encrypted JSONB NOT NULL,
    operation_encrypted JSONB,
    expires_at TIMESTAMPTZ,
    retention_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE travel_rule_email_jobs (
    id UUID PRIMARY KEY,
    transfer_id UUID NOT NULL REFERENCES travel_rule_transfers(id) ON DELETE CASCADE,
    recipient_email_encrypted JSONB NOT NULL,
    token_encrypted JSONB,
    token_digest BYTEA UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'failed', 'sent', 'dead_lettered', 'consumed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    last_error_code TEXT,
    created_by_user_id BIGINT NOT NULL REFERENCES auth_users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX idx_travel_rule_email_jobs_dispatch
ON travel_rule_email_jobs (status, next_attempt_at)
WHERE status IN ('queued', 'failed', 'processing');

CREATE INDEX idx_travel_rule_email_jobs_transfer_created
ON travel_rule_email_jobs (transfer_id, created_at DESC);

CREATE TABLE travel_rule_tokens (
    id UUID PRIMARY KEY,
    transfer_id UUID NOT NULL REFERENCES travel_rule_transfers(id) ON DELETE CASCADE,
    digest BYTEA UNIQUE NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('inquiry', 'resolution', 'confirmation')),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE travel_rule_messages (
    id UUID PRIMARY KEY,
    transfer_id UUID NOT NULL REFERENCES travel_rule_transfers(id) ON DELETE CASCADE,
    phase TEXT NOT NULL CHECK (phase IN ('inquiry', 'resolution', 'confirmation')),
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    logical_identifier UUID NOT NULL,
    request_identifier UUID NOT NULL,
    peer_fingerprint TEXT,
    request_encrypted JSONB,
    response_encrypted JSONB,
    delivery_state TEXT NOT NULL CHECK (delivery_state IN ('received', 'pending', 'delivered', 'failed')),
    status_code INTEGER,
    error_code TEXT,
    superseded_by UUID REFERENCES travel_rule_messages(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
);

CREATE TABLE travel_rule_events (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    transfer_id UUID NOT NULL REFERENCES travel_rule_transfers(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    from_state TEXT,
    to_state TEXT,
    actor_user_id BIGINT,
    actor_email_encrypted JSONB,
    actor_role TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE api_clients (
    id UUID PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    scopes JSONB NOT NULL CHECK (jsonb_typeof(scopes) = 'array'),
    status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO api_clients (id, name, scopes, status)
VALUES ('00000000-0000-4000-8000-000000000001', 'legacy-service-api-key', '["transfers:read", "transfers:write", "webhooks:manage"]'::JSONB, 'active');

CREATE TABLE api_client_credentials (
    id UUID PRIMARY KEY,
    api_client_id UUID NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
    key_digest BYTEA UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE counterparties (
    id UUID PRIMARY KEY,
    external_id TEXT UNIQUE NOT NULL,
    legal_name TEXT NOT NULL,
    jurisdiction TEXT,
    counterparty_type TEXT NOT NULL CHECK (counterparty_type IN ('hosted', 'unhosted', 'unknown')),
    capabilities JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(capabilities) = 'array'),
    trust_state TEXT NOT NULL DEFAULT 'unverified' CHECK (trust_state IN ('unverified', 'trusted', 'restricted', 'blocked')),
    metadata_encrypted JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orchestration_transfers (
    id UUID PRIMARY KEY,
    api_client_id UUID NOT NULL REFERENCES api_clients(id),
    counterparty_id UUID REFERENCES counterparties(id),
    external_id TEXT NOT NULL,
    idempotency_key_digest BYTEA NOT NULL,
    request_digest BYTEA NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    state TEXT NOT NULL CHECK (state IN ('created', 'on_hold', 'ready', 'released', 'settled', 'returned', 'canceled')),
    policy_profile TEXT NOT NULL CHECK (policy_profile IN ('TR-MASAK-2025', 'EU-TFR-2024')),
    counterparty_type TEXT NOT NULL CHECK (counterparty_type IN ('hosted', 'unhosted', 'unknown')),
    asset_code TEXT NOT NULL,
    asset_network TEXT NOT NULL,
    amount TEXT NOT NULL,
    data_encrypted JSONB NOT NULL,
    operation_encrypted JSONB,
    settlement_reference TEXT,
    retention_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (api_client_id, external_id),
    UNIQUE (api_client_id, idempotency_key_digest)
);

CREATE TABLE compliance_cases (
    id UUID PRIMARY KEY,
    transfer_id UUID UNIQUE NOT NULL REFERENCES orchestration_transfers(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('pending', 'needs_information', 'approved', 'rejected', 'escalated', 'expired')),
    required_approval TEXT NOT NULL CHECK (required_approval IN ('none', 'compliance_reviewer', 'compliance_approver')),
    assignee_user_id BIGINT REFERENCES auth_users(id),
    version INTEGER NOT NULL DEFAULT 0,
    data_encrypted JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE policy_decisions (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES compliance_cases(id) ON DELETE CASCADE,
    profile TEXT NOT NULL CHECK (profile IN ('TR-MASAK-2025', 'EU-TFR-2024')),
    action TEXT NOT NULL CHECK (action IN ('allow', 'hold', 'manual_review', 'reject', 'return')),
    reason_codes JSONB NOT NULL CHECK (jsonb_typeof(reason_codes) = 'array'),
    required_fields JSONB NOT NULL CHECK (jsonb_typeof(required_fields) = 'array'),
    snapshot_hash BYTEA NOT NULL,
    decision JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE case_reviews (
    id UUID PRIMARY KEY,
    case_id UUID NOT NULL REFERENCES compliance_cases(id) ON DELETE CASCADE,
    actor_user_id BIGINT NOT NULL REFERENCES auth_users(id),
    actor_role TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN ('reviewer', 'approver')),
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'escalated')),
    reason_encrypted JSONB NOT NULL,
    case_version INTEGER NOT NULL CHECK (case_version >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (case_id, actor_user_id, stage)
);

CREATE TABLE protocol_exchanges (
    id UUID PRIMARY KEY,
    transfer_id UUID NOT NULL REFERENCES orchestration_transfers(id) ON DELETE CASCADE,
    connector_key TEXT NOT NULL,
    transport_key TEXT,
    state TEXT NOT NULL CHECK (state IN ('queued', 'delivering', 'awaiting_counterparty', 'completed', 'failed', 'dead_lettered', 'canceled')),
    capabilities JSONB NOT NULL CHECK (jsonb_typeof(capabilities) = 'array'),
    pii_disclosed BOOLEAN NOT NULL DEFAULT FALSE,
    remote_reference TEXT,
    compatibility_state TEXT,
    deadline_at TIMESTAMPTZ,
    data_encrypted JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE protocol_messages (
    id UUID PRIMARY KEY,
    exchange_id UUID NOT NULL REFERENCES protocol_exchanges(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    message_type TEXT NOT NULL,
    body_encrypted JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE delivery_attempts (
    id UUID PRIMARY KEY,
    message_id UUID NOT NULL REFERENCES protocol_messages(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL CHECK (attempt > 0),
    state TEXT NOT NULL CHECK (state IN ('pending', 'delivered', 'failed', 'dead_lettered')),
    status_code INTEGER,
    error_code TEXT,
    response_encrypted JSONB,
    next_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (message_id, attempt)
);

CREATE TABLE webhook_subscriptions (
    id UUID PRIMARY KEY,
    api_client_id UUID NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
    url_encrypted JSONB NOT NULL,
    secret_encrypted JSONB NOT NULL,
    event_types JSONB NOT NULL CHECK (jsonb_typeof(event_types) = 'array'),
    status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE outbox_jobs (
    id UUID PRIMARY KEY,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    payload_encrypted JSONB NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'delivered', 'failed', 'dead_lettered')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    last_error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ
);

CREATE TABLE webhook_delivery_attempts (
    id UUID PRIMARY KEY,
    outbox_job_id UUID NOT NULL REFERENCES outbox_jobs(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL CHECK (attempt > 0),
    state TEXT NOT NULL CHECK (state IN ('delivered', 'failed', 'dead_lettered')),
    status_code INTEGER,
    error_code TEXT,
    next_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (outbox_job_id, attempt)
);

CREATE TABLE audit_events (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    action TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('api_client', 'user', 'system')),
    actor_id TEXT,
    previous_hash BYTEA,
    event_hash BYTEA UNIQUE NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE encryption_reencryption_jobs (
    id UUID PRIMARY KEY,
    target_key_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('running', 'processing', 'completed', 'failed')),
    target_index INTEGER NOT NULL DEFAULT 0 CHECK (target_index >= 0),
    last_record_id TEXT,
    processed_records BIGINT NOT NULL DEFAULT 0 CHECK (processed_records >= 0),
    locked_at TIMESTAMPTZ,
    last_error_code TEXT,
    created_by_user_id BIGINT NOT NULL REFERENCES auth_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_error_logs_created_at ON error_logs (created_at DESC);
CREATE INDEX idx_auth_users_active_created ON auth_users (is_active, created_at DESC);
CREATE INDEX idx_auth_users_email_trgm ON auth_users USING GIN (email gin_trgm_ops);
CREATE INDEX idx_auth_action_history_user_id ON auth_action_history (user_id);
CREATE INDEX idx_auth_action_history_action_created ON auth_action_history (action, created_at DESC);
CREATE INDEX idx_travel_rule_transfers_review ON travel_rule_transfers (direction, state, created_at DESC);
CREATE INDEX idx_travel_rule_transfers_retention ON travel_rule_transfers (retention_until);
CREATE INDEX idx_travel_rule_tokens_transfer_purpose ON travel_rule_tokens (transfer_id, purpose);
CREATE UNIQUE INDEX idx_travel_rule_inbound_replay ON travel_rule_messages (peer_fingerprint, request_identifier) WHERE direction = 'inbound';
CREATE INDEX idx_travel_rule_messages_retry ON travel_rule_messages (transfer_id, delivery_state, created_at DESC);
CREATE INDEX idx_travel_rule_events_transfer ON travel_rule_events (transfer_id, created_at DESC);
CREATE INDEX idx_api_client_credentials_client ON api_client_credentials (api_client_id, created_at DESC);
CREATE INDEX idx_counterparties_trust ON counterparties (trust_state, updated_at DESC);
CREATE INDEX idx_orchestration_transfers_client_created ON orchestration_transfers (api_client_id, created_at DESC);
CREATE INDEX idx_orchestration_transfers_state ON orchestration_transfers (state, updated_at DESC);
CREATE INDEX idx_compliance_cases_state ON compliance_cases (state, updated_at DESC);
CREATE INDEX idx_policy_decisions_case ON policy_decisions (case_id, created_at DESC);
CREATE INDEX idx_case_reviews_case ON case_reviews (case_id, created_at, id);
CREATE INDEX idx_protocol_exchanges_transfer ON protocol_exchanges (transfer_id, created_at DESC);
CREATE INDEX idx_protocol_exchanges_compatibility ON protocol_exchanges (connector_key, compatibility_state, updated_at);
CREATE INDEX idx_protocol_messages_exchange ON protocol_messages (exchange_id, created_at DESC);
CREATE INDEX idx_delivery_attempts_retry ON delivery_attempts (state, next_attempt_at) WHERE state IN ('pending', 'failed');
CREATE INDEX idx_webhook_subscriptions_client ON webhook_subscriptions (api_client_id, status);
CREATE INDEX idx_outbox_jobs_dispatch ON outbox_jobs (state, next_attempt_at) WHERE state IN ('pending', 'failed');
CREATE INDEX idx_webhook_delivery_attempts_job ON webhook_delivery_attempts (outbox_job_id, attempt DESC);
CREATE INDEX idx_audit_events_aggregate ON audit_events (aggregate_type, aggregate_id, id);
CREATE UNIQUE INDEX idx_encryption_reencryption_single_active ON encryption_reencryption_jobs ((TRUE)) WHERE state IN ('running', 'processing');
CREATE INDEX idx_encryption_reencryption_created ON encryption_reencryption_jobs (created_at DESC, id DESC);
