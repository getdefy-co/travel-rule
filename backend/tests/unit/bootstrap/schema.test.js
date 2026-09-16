const loadSchemaBootstrap = async () => import('../../../src/bootstrap/schema');

const normalizeConstraint = ({ definition, table, name }) => `${table}.${name}:${definition.replaceAll(/\s+/g, '')}`;

const columnMetadata = (dataType, { defaultExpression = null, identity = '', notNull = false } = {}) => ({ dataType, defaultExpression, identity, notNull });

const COLUMN_METADATA = {
  'error_logs.id': columnMetadata('bigint', { identity: 'a', notNull: true }),
  'error_logs.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'error_logs.function_name': columnMetadata('text'),
  'error_logs.message': columnMetadata('text'),
  'error_logs.url': columnMetadata('text'),
  'error_logs.details': columnMetadata('jsonb'),
  'error_logs.status': columnMetadata('text'),
  'auth_users.id': columnMetadata('bigint', { identity: 'a', notNull: true }),
  'auth_users.email': columnMetadata('text', { notNull: true }),
  'auth_users.password': columnMetadata('text', { notNull: true }),
  'auth_users.role': columnMetadata('text', { defaultExpression: "'user'::text", notNull: true }),
  'auth_users.is_active': columnMetadata('boolean', { defaultExpression: 'true', notNull: true }),
  'auth_users.session_version': columnMetadata('integer', { defaultExpression: '0', notNull: true }),
  'auth_users.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'auth_reset_password_tokens.id': columnMetadata('bigint', { identity: 'a', notNull: true }),
  'auth_reset_password_tokens.user_id': columnMetadata('bigint', { notNull: true }),
  'auth_reset_password_tokens.token_digest': columnMetadata('bytea', { notNull: true }),
  'auth_reset_password_tokens.expires_at': columnMetadata('timestamp with time zone', { defaultExpression: "(now() + '1 day'::interval)", notNull: true }),
  'auth_reset_password_tokens.used_at': columnMetadata('timestamp with time zone'),
  'auth_reset_password_tokens.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'auth_action_history.id': columnMetadata('bigint', { identity: 'a', notNull: true }),
  'auth_action_history.user_id': columnMetadata('bigint', { notNull: true }),
  'auth_action_history.action': columnMetadata('text', { defaultExpression: "'default'::text", notNull: true }),
  'auth_action_history.data': columnMetadata('jsonb', { notNull: true }),
  'auth_action_history.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'trp_configuration.name': columnMetadata('text', { notNull: true }),
  'trp_configuration.value_encrypted': columnMetadata('jsonb', { notNull: true }),
  'trp_configuration.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'trp_configuration.updated_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'travel_rule_transfers.id': columnMetadata('uuid', { notNull: true }),
  'travel_rule_transfers.protocol': columnMetadata('text', { notNull: true }),
  'travel_rule_transfers.direction': columnMetadata('text', { notNull: true }),
  'travel_rule_transfers.state': columnMetadata('text', { notNull: true }),
  'travel_rule_transfers.asset_dti': columnMetadata('text'),
  'travel_rule_transfers.amount': columnMetadata('text'),
  'travel_rule_transfers.payload_encrypted': columnMetadata('jsonb', { notNull: true }),
  'travel_rule_transfers.operation_encrypted': columnMetadata('jsonb'),
  'travel_rule_transfers.expires_at': columnMetadata('timestamp with time zone'),
  'travel_rule_transfers.retention_until': columnMetadata('timestamp with time zone', { notNull: true }),
  'travel_rule_transfers.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'travel_rule_transfers.updated_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'travel_rule_email_jobs.id': columnMetadata('uuid', { notNull: true }),
  'travel_rule_email_jobs.transfer_id': columnMetadata('uuid', { notNull: true }),
  'travel_rule_email_jobs.recipient_email_encrypted': columnMetadata('jsonb', { notNull: true }),
  'travel_rule_email_jobs.token_encrypted': columnMetadata('jsonb'),
  'travel_rule_email_jobs.token_digest': columnMetadata('bytea', { notNull: true }),
  'travel_rule_email_jobs.status': columnMetadata('text', { defaultExpression: "'queued'::text", notNull: true }),
  'travel_rule_email_jobs.attempts': columnMetadata('integer', { defaultExpression: '0', notNull: true }),
  'travel_rule_email_jobs.next_attempt_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'travel_rule_email_jobs.locked_at': columnMetadata('timestamp with time zone'),
  'travel_rule_email_jobs.last_error_code': columnMetadata('text'),
  'travel_rule_email_jobs.created_by_user_id': columnMetadata('bigint', { notNull: true }),
  'travel_rule_email_jobs.expires_at': columnMetadata('timestamp with time zone', { notNull: true }),
  'travel_rule_email_jobs.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'travel_rule_email_jobs.updated_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'travel_rule_email_jobs.sent_at': columnMetadata('timestamp with time zone'),
  'travel_rule_email_jobs.consumed_at': columnMetadata('timestamp with time zone'),
  'travel_rule_tokens.id': columnMetadata('uuid', { notNull: true }),
  'travel_rule_tokens.transfer_id': columnMetadata('uuid', { notNull: true }),
  'travel_rule_tokens.digest': columnMetadata('bytea', { notNull: true }),
  'travel_rule_tokens.purpose': columnMetadata('text', { notNull: true }),
  'travel_rule_tokens.expires_at': columnMetadata('timestamp with time zone', { notNull: true }),
  'travel_rule_tokens.consumed_at': columnMetadata('timestamp with time zone'),
  'travel_rule_tokens.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'travel_rule_messages.id': columnMetadata('uuid', { notNull: true }),
  'travel_rule_messages.transfer_id': columnMetadata('uuid', { notNull: true }),
  'travel_rule_messages.phase': columnMetadata('text', { notNull: true }),
  'travel_rule_messages.direction': columnMetadata('text', { notNull: true }),
  'travel_rule_messages.logical_identifier': columnMetadata('uuid', { notNull: true }),
  'travel_rule_messages.request_identifier': columnMetadata('uuid', { notNull: true }),
  'travel_rule_messages.peer_fingerprint': columnMetadata('text'),
  'travel_rule_messages.request_encrypted': columnMetadata('jsonb'),
  'travel_rule_messages.response_encrypted': columnMetadata('jsonb'),
  'travel_rule_messages.delivery_state': columnMetadata('text', { notNull: true }),
  'travel_rule_messages.status_code': columnMetadata('integer'),
  'travel_rule_messages.error_code': columnMetadata('text'),
  'travel_rule_messages.superseded_by': columnMetadata('uuid'),
  'travel_rule_messages.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'travel_rule_messages.delivered_at': columnMetadata('timestamp with time zone'),
  'travel_rule_events.id': columnMetadata('bigint', { identity: 'a', notNull: true }),
  'travel_rule_events.transfer_id': columnMetadata('uuid', { notNull: true }),
  'travel_rule_events.event_type': columnMetadata('text', { notNull: true }),
  'travel_rule_events.from_state': columnMetadata('text'),
  'travel_rule_events.to_state': columnMetadata('text'),
  'travel_rule_events.actor_user_id': columnMetadata('bigint'),
  'travel_rule_events.actor_email_encrypted': columnMetadata('jsonb'),
  'travel_rule_events.actor_role': columnMetadata('text'),
  'travel_rule_events.metadata': columnMetadata('jsonb', { defaultExpression: "'{}'::jsonb", notNull: true }),
  'travel_rule_events.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
};

const indexMetadata = ({ keys, table, method = 'btree', predicate = null, unique = false }) => ({ keys, method, predicate, ready: true, table, unique, valid: true });

const indexKey = (definition, { descending = false, nullsFirst = false, opclass = null } = {}) => ({ definition, descending, nullsFirst, opclass });

const INDEX_METADATA = {
  idx_error_logs_created_at: indexMetadata({ keys: [indexKey('created_at', { descending: true, nullsFirst: true })], table: 'error_logs' }),
  idx_auth_users_active_created: indexMetadata({ keys: [indexKey('is_active'), indexKey('created_at', { descending: true, nullsFirst: true })], table: 'auth_users' }),
  idx_auth_users_email_trgm: indexMetadata({ keys: [indexKey('email', { opclass: 'gin_trgm_ops' })], method: 'gin', table: 'auth_users' }),
  idx_auth_action_history_user_id: indexMetadata({ keys: [indexKey('user_id')], table: 'auth_action_history' }),
  idx_auth_action_history_action_created: indexMetadata({ keys: [indexKey('action'), indexKey('created_at', { descending: true, nullsFirst: true })], table: 'auth_action_history' }),
  idx_travel_rule_transfers_review: indexMetadata({ keys: [indexKey('direction'), indexKey('state'), indexKey('created_at', { descending: true, nullsFirst: true })], table: 'travel_rule_transfers' }),
  idx_travel_rule_transfers_retention: indexMetadata({ keys: [indexKey('retention_until')], table: 'travel_rule_transfers' }),
  idx_travel_rule_email_jobs_dispatch: indexMetadata({
    keys: [indexKey('status'), indexKey('next_attempt_at')],
    predicate: "(status = ANY (ARRAY['queued'::text, 'failed'::text, 'processing'::text]))",
    table: 'travel_rule_email_jobs',
  }),
  idx_travel_rule_email_jobs_transfer_created: indexMetadata({
    keys: [indexKey('transfer_id'), indexKey('created_at', { descending: true, nullsFirst: true })],
    table: 'travel_rule_email_jobs',
  }),
  idx_travel_rule_tokens_transfer_purpose: indexMetadata({ keys: [indexKey('transfer_id'), indexKey('purpose')], table: 'travel_rule_tokens' }),
  idx_travel_rule_inbound_replay: indexMetadata({
    keys: [indexKey('peer_fingerprint'), indexKey('request_identifier')],
    predicate: "(direction = 'inbound'::text)",
    table: 'travel_rule_messages',
    unique: true,
  }),
  idx_travel_rule_messages_retry: indexMetadata({
    keys: [indexKey('transfer_id'), indexKey('delivery_state'), indexKey('created_at', { descending: true, nullsFirst: true })],
    table: 'travel_rule_messages',
  }),
  idx_travel_rule_events_transfer: indexMetadata({ keys: [indexKey('transfer_id'), indexKey('created_at', { descending: true, nullsFirst: true })], table: 'travel_rule_events' }),
};

const ORCHESTRATION_TABLES = [
  'api_clients',
  'api_client_credentials',
  'counterparties',
  'orchestration_transfers',
  'compliance_cases',
  'policy_decisions',
  'case_reviews',
  'protocol_exchanges',
  'protocol_messages',
  'delivery_attempts',
  'webhook_subscriptions',
  'outbox_jobs',
  'webhook_delivery_attempts',
  'audit_events',
  'encryption_reencryption_jobs',
];

const ORCHESTRATION_COLUMN_METADATA = {
  'api_clients.id': columnMetadata('uuid', { notNull: true }),
  'api_clients.name': columnMetadata('text', { notNull: true }),
  'api_clients.scopes': columnMetadata('jsonb', { notNull: true }),
  'api_clients.status': columnMetadata('text', { notNull: true }),
  'api_clients.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'api_clients.updated_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'api_client_credentials.id': columnMetadata('uuid', { notNull: true }),
  'api_client_credentials.api_client_id': columnMetadata('uuid', { notNull: true }),
  'api_client_credentials.key_digest': columnMetadata('bytea', { notNull: true }),
  'api_client_credentials.expires_at': columnMetadata('timestamp with time zone'),
  'api_client_credentials.revoked_at': columnMetadata('timestamp with time zone'),
  'api_client_credentials.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'counterparties.id': columnMetadata('uuid', { notNull: true }),
  'counterparties.external_id': columnMetadata('text', { notNull: true }),
  'counterparties.legal_name': columnMetadata('text', { notNull: true }),
  'counterparties.jurisdiction': columnMetadata('text'),
  'counterparties.counterparty_type': columnMetadata('text', { notNull: true }),
  'counterparties.capabilities': columnMetadata('jsonb', { defaultExpression: "'[]'::jsonb", notNull: true }),
  'counterparties.trust_state': columnMetadata('text', { defaultExpression: "'unverified'::text", notNull: true }),
  'counterparties.metadata_encrypted': columnMetadata('jsonb'),
  'counterparties.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'counterparties.updated_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'orchestration_transfers.id': columnMetadata('uuid', { notNull: true }),
  'orchestration_transfers.api_client_id': columnMetadata('uuid', { notNull: true }),
  'orchestration_transfers.counterparty_id': columnMetadata('uuid'),
  'orchestration_transfers.external_id': columnMetadata('text', { notNull: true }),
  'orchestration_transfers.idempotency_key_digest': columnMetadata('bytea', { notNull: true }),
  'orchestration_transfers.request_digest': columnMetadata('bytea', { notNull: true }),
  'orchestration_transfers.direction': columnMetadata('text', { notNull: true }),
  'orchestration_transfers.state': columnMetadata('text', { notNull: true }),
  'orchestration_transfers.policy_profile': columnMetadata('text', { notNull: true }),
  'orchestration_transfers.counterparty_type': columnMetadata('text', { notNull: true }),
  'orchestration_transfers.asset_code': columnMetadata('text', { notNull: true }),
  'orchestration_transfers.asset_network': columnMetadata('text', { notNull: true }),
  'orchestration_transfers.amount': columnMetadata('text', { notNull: true }),
  'orchestration_transfers.data_encrypted': columnMetadata('jsonb', { notNull: true }),
  'orchestration_transfers.operation_encrypted': columnMetadata('jsonb'),
  'orchestration_transfers.settlement_reference': columnMetadata('text'),
  'orchestration_transfers.retention_until': columnMetadata('timestamp with time zone', { notNull: true }),
  'orchestration_transfers.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'orchestration_transfers.updated_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'compliance_cases.id': columnMetadata('uuid', { notNull: true }),
  'compliance_cases.transfer_id': columnMetadata('uuid', { notNull: true }),
  'compliance_cases.state': columnMetadata('text', { notNull: true }),
  'compliance_cases.required_approval': columnMetadata('text', { notNull: true }),
  'compliance_cases.assignee_user_id': columnMetadata('bigint'),
  'compliance_cases.version': columnMetadata('integer', { defaultExpression: '0', notNull: true }),
  'compliance_cases.data_encrypted': columnMetadata('jsonb', { notNull: true }),
  'compliance_cases.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'compliance_cases.updated_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'policy_decisions.id': columnMetadata('uuid', { notNull: true }),
  'policy_decisions.case_id': columnMetadata('uuid', { notNull: true }),
  'policy_decisions.profile': columnMetadata('text', { notNull: true }),
  'policy_decisions.action': columnMetadata('text', { notNull: true }),
  'policy_decisions.reason_codes': columnMetadata('jsonb', { notNull: true }),
  'policy_decisions.required_fields': columnMetadata('jsonb', { notNull: true }),
  'policy_decisions.snapshot_hash': columnMetadata('bytea', { notNull: true }),
  'policy_decisions.decision': columnMetadata('jsonb', { notNull: true }),
  'policy_decisions.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'case_reviews.id': columnMetadata('uuid', { notNull: true }),
  'case_reviews.case_id': columnMetadata('uuid', { notNull: true }),
  'case_reviews.actor_user_id': columnMetadata('bigint', { notNull: true }),
  'case_reviews.actor_role': columnMetadata('text', { notNull: true }),
  'case_reviews.stage': columnMetadata('text', { notNull: true }),
  'case_reviews.decision': columnMetadata('text', { notNull: true }),
  'case_reviews.reason_encrypted': columnMetadata('jsonb', { notNull: true }),
  'case_reviews.case_version': columnMetadata('integer', { notNull: true }),
  'case_reviews.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'protocol_exchanges.id': columnMetadata('uuid', { notNull: true }),
  'protocol_exchanges.transfer_id': columnMetadata('uuid', { notNull: true }),
  'protocol_exchanges.connector_key': columnMetadata('text', { notNull: true }),
  'protocol_exchanges.transport_key': columnMetadata('text'),
  'protocol_exchanges.state': columnMetadata('text', { notNull: true }),
  'protocol_exchanges.capabilities': columnMetadata('jsonb', { notNull: true }),
  'protocol_exchanges.pii_disclosed': columnMetadata('boolean', { defaultExpression: 'false', notNull: true }),
  'protocol_exchanges.remote_reference': columnMetadata('text'),
  'protocol_exchanges.compatibility_state': columnMetadata('text'),
  'protocol_exchanges.deadline_at': columnMetadata('timestamp with time zone'),
  'protocol_exchanges.data_encrypted': columnMetadata('jsonb', { notNull: true }),
  'protocol_exchanges.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'protocol_exchanges.updated_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'protocol_messages.id': columnMetadata('uuid', { notNull: true }),
  'protocol_messages.exchange_id': columnMetadata('uuid', { notNull: true }),
  'protocol_messages.direction': columnMetadata('text', { notNull: true }),
  'protocol_messages.message_type': columnMetadata('text', { notNull: true }),
  'protocol_messages.body_encrypted': columnMetadata('jsonb', { notNull: true }),
  'protocol_messages.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'delivery_attempts.id': columnMetadata('uuid', { notNull: true }),
  'delivery_attempts.message_id': columnMetadata('uuid', { notNull: true }),
  'delivery_attempts.attempt': columnMetadata('integer', { notNull: true }),
  'delivery_attempts.state': columnMetadata('text', { notNull: true }),
  'delivery_attempts.status_code': columnMetadata('integer'),
  'delivery_attempts.error_code': columnMetadata('text'),
  'delivery_attempts.response_encrypted': columnMetadata('jsonb'),
  'delivery_attempts.next_attempt_at': columnMetadata('timestamp with time zone'),
  'delivery_attempts.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'delivery_attempts.completed_at': columnMetadata('timestamp with time zone'),
  'webhook_subscriptions.id': columnMetadata('uuid', { notNull: true }),
  'webhook_subscriptions.api_client_id': columnMetadata('uuid', { notNull: true }),
  'webhook_subscriptions.url_encrypted': columnMetadata('jsonb', { notNull: true }),
  'webhook_subscriptions.secret_encrypted': columnMetadata('jsonb', { notNull: true }),
  'webhook_subscriptions.event_types': columnMetadata('jsonb', { notNull: true }),
  'webhook_subscriptions.status': columnMetadata('text', { notNull: true }),
  'webhook_subscriptions.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'webhook_subscriptions.updated_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'outbox_jobs.id': columnMetadata('uuid', { notNull: true }),
  'outbox_jobs.aggregate_type': columnMetadata('text', { notNull: true }),
  'outbox_jobs.aggregate_id': columnMetadata('uuid', { notNull: true }),
  'outbox_jobs.event_type': columnMetadata('text', { notNull: true }),
  'outbox_jobs.payload_encrypted': columnMetadata('jsonb', { notNull: true }),
  'outbox_jobs.state': columnMetadata('text', { notNull: true }),
  'outbox_jobs.attempts': columnMetadata('integer', { defaultExpression: '0', notNull: true }),
  'outbox_jobs.next_attempt_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'outbox_jobs.locked_at': columnMetadata('timestamp with time zone'),
  'outbox_jobs.last_error_code': columnMetadata('text'),
  'outbox_jobs.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'outbox_jobs.delivered_at': columnMetadata('timestamp with time zone'),
  'webhook_delivery_attempts.id': columnMetadata('uuid', { notNull: true }),
  'webhook_delivery_attempts.outbox_job_id': columnMetadata('uuid', { notNull: true }),
  'webhook_delivery_attempts.attempt': columnMetadata('integer', { notNull: true }),
  'webhook_delivery_attempts.state': columnMetadata('text', { notNull: true }),
  'webhook_delivery_attempts.status_code': columnMetadata('integer'),
  'webhook_delivery_attempts.error_code': columnMetadata('text'),
  'webhook_delivery_attempts.next_attempt_at': columnMetadata('timestamp with time zone'),
  'webhook_delivery_attempts.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'webhook_delivery_attempts.completed_at': columnMetadata('timestamp with time zone'),
  'audit_events.id': columnMetadata('bigint', { identity: 'a', notNull: true }),
  'audit_events.aggregate_type': columnMetadata('text', { notNull: true }),
  'audit_events.aggregate_id': columnMetadata('uuid', { notNull: true }),
  'audit_events.action': columnMetadata('text', { notNull: true }),
  'audit_events.actor_type': columnMetadata('text', { notNull: true }),
  'audit_events.actor_id': columnMetadata('text'),
  'audit_events.previous_hash': columnMetadata('bytea'),
  'audit_events.event_hash': columnMetadata('bytea', { notNull: true }),
  'audit_events.payload': columnMetadata('jsonb', { notNull: true }),
  'audit_events.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'encryption_reencryption_jobs.id': columnMetadata('uuid', { notNull: true }),
  'encryption_reencryption_jobs.target_key_id': columnMetadata('text', { notNull: true }),
  'encryption_reencryption_jobs.state': columnMetadata('text', { notNull: true }),
  'encryption_reencryption_jobs.target_index': columnMetadata('integer', { defaultExpression: '0', notNull: true }),
  'encryption_reencryption_jobs.last_record_id': columnMetadata('text'),
  'encryption_reencryption_jobs.processed_records': columnMetadata('bigint', { defaultExpression: '0', notNull: true }),
  'encryption_reencryption_jobs.locked_at': columnMetadata('timestamp with time zone'),
  'encryption_reencryption_jobs.last_error_code': columnMetadata('text'),
  'encryption_reencryption_jobs.created_by_user_id': columnMetadata('bigint', { notNull: true }),
  'encryption_reencryption_jobs.created_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'encryption_reencryption_jobs.updated_at': columnMetadata('timestamp with time zone', { defaultExpression: 'now()', notNull: true }),
  'encryption_reencryption_jobs.completed_at': columnMetadata('timestamp with time zone'),
};

const ORCHESTRATION_CONSTRAINTS = [
  'api_clients.api_clients_pkey:PRIMARYKEY(id)',
  'api_clients.api_clients_name_key:UNIQUE(name)',
  "api_clients.api_clients_scopes_check:CHECK(jsonb_typeof(scopes)='array'::text)",
  "api_clients.api_clients_status_check:CHECK(status=ANY(ARRAY['active'::text,'disabled'::text]))",
  'api_client_credentials.api_client_credentials_pkey:PRIMARYKEY(id)',
  'api_client_credentials.api_client_credentials_api_client_id_fkey:FOREIGNKEY(api_client_id)REFERENCESapi_clients(id)ONDELETECASCADE',
  'api_client_credentials.api_client_credentials_key_digest_key:UNIQUE(key_digest)',
  'counterparties.counterparties_pkey:PRIMARYKEY(id)',
  'counterparties.counterparties_external_id_key:UNIQUE(external_id)',
  "counterparties.counterparties_counterparty_type_check:CHECK(counterparty_type=ANY(ARRAY['hosted'::text,'unhosted'::text,'unknown'::text]))",
  "counterparties.counterparties_capabilities_check:CHECK(jsonb_typeof(capabilities)='array'::text)",
  "counterparties.counterparties_trust_state_check:CHECK(trust_state=ANY(ARRAY['unverified'::text,'trusted'::text,'restricted'::text,'blocked'::text]))",
  'orchestration_transfers.orchestration_transfers_pkey:PRIMARYKEY(id)',
  'orchestration_transfers.orchestration_transfers_api_client_id_fkey:FOREIGNKEY(api_client_id)REFERENCESapi_clients(id)',
  'orchestration_transfers.orchestration_transfers_counterparty_id_fkey:FOREIGNKEY(counterparty_id)REFERENCEScounterparties(id)',
  "orchestration_transfers.orchestration_transfers_direction_check:CHECK(direction=ANY(ARRAY['inbound'::text,'outbound'::text]))",
  [
    "orchestration_transfers.orchestration_transfers_state_check:CHECK(state=ANY(ARRAY['created'::text,'on_hold'::text,'ready'::text,",
    "'released'::text,'settled'::text,'returned'::text,'canceled'::text]))",
  ].join(''),
  "orchestration_transfers.orchestration_transfers_policy_profile_check:CHECK(policy_profile=ANY(ARRAY['TR-MASAK-2025'::text,'EU-TFR-2024'::text]))",
  "orchestration_transfers.orchestration_transfers_counterparty_type_check:CHECK(counterparty_type=ANY(ARRAY['hosted'::text,'unhosted'::text,'unknown'::text]))",
  'orchestration_transfers.orchestration_transfers_api_client_id_external_id_key:UNIQUE(api_client_id,external_id)',
  'orchestration_transfers.orchestration_transfers_api_client_id_idempotency_key_diges_key:UNIQUE(api_client_id,idempotency_key_digest)',
  'compliance_cases.compliance_cases_pkey:PRIMARYKEY(id)',
  'compliance_cases.compliance_cases_transfer_id_key:UNIQUE(transfer_id)',
  'compliance_cases.compliance_cases_transfer_id_fkey:FOREIGNKEY(transfer_id)REFERENCESorchestration_transfers(id)ONDELETECASCADE',
  "compliance_cases.compliance_cases_state_check:CHECK(state=ANY(ARRAY['pending'::text,'needs_information'::text,'approved'::text,'rejected'::text,'escalated'::text,'expired'::text]))",
  "compliance_cases.compliance_cases_required_approval_check:CHECK(required_approval=ANY(ARRAY['none'::text,'compliance_reviewer'::text,'compliance_approver'::text]))",
  'compliance_cases.compliance_cases_assignee_user_id_fkey:FOREIGNKEY(assignee_user_id)REFERENCESauth_users(id)',
  'policy_decisions.policy_decisions_pkey:PRIMARYKEY(id)',
  'policy_decisions.policy_decisions_case_id_fkey:FOREIGNKEY(case_id)REFERENCEScompliance_cases(id)ONDELETECASCADE',
  "policy_decisions.policy_decisions_profile_check:CHECK(profile=ANY(ARRAY['TR-MASAK-2025'::text,'EU-TFR-2024'::text]))",
  "policy_decisions.policy_decisions_action_check:CHECK(action=ANY(ARRAY['allow'::text,'hold'::text,'manual_review'::text,'reject'::text,'return'::text]))",
  "policy_decisions.policy_decisions_reason_codes_check:CHECK(jsonb_typeof(reason_codes)='array'::text)",
  "policy_decisions.policy_decisions_required_fields_check:CHECK(jsonb_typeof(required_fields)='array'::text)",
  'case_reviews.case_reviews_pkey:PRIMARYKEY(id)',
  'case_reviews.case_reviews_case_id_fkey:FOREIGNKEY(case_id)REFERENCEScompliance_cases(id)ONDELETECASCADE',
  'case_reviews.case_reviews_actor_user_id_fkey:FOREIGNKEY(actor_user_id)REFERENCESauth_users(id)',
  "case_reviews.case_reviews_stage_check:CHECK(stage=ANY(ARRAY['reviewer'::text,'approver'::text]))",
  "case_reviews.case_reviews_decision_check:CHECK(decision=ANY(ARRAY['approved'::text,'rejected'::text,'escalated'::text]))",
  'case_reviews.case_reviews_case_version_check:CHECK(case_version>=0)',
  'case_reviews.case_reviews_case_id_actor_user_id_stage_key:UNIQUE(case_id,actor_user_id,stage)',
  'protocol_exchanges.protocol_exchanges_pkey:PRIMARYKEY(id)',
  'protocol_exchanges.protocol_exchanges_transfer_id_fkey:FOREIGNKEY(transfer_id)REFERENCESorchestration_transfers(id)ONDELETECASCADE',
  [
    "protocol_exchanges.protocol_exchanges_state_check:CHECK(state=ANY(ARRAY['queued'::text,'delivering'::text,'awaiting_counterparty'::text,",
    "'completed'::text,'failed'::text,'dead_lettered'::text,'canceled'::text]))",
  ].join(''),
  "protocol_exchanges.protocol_exchanges_capabilities_check:CHECK(jsonb_typeof(capabilities)='array'::text)",
  'protocol_messages.protocol_messages_pkey:PRIMARYKEY(id)',
  'protocol_messages.protocol_messages_exchange_id_fkey:FOREIGNKEY(exchange_id)REFERENCESprotocol_exchanges(id)ONDELETECASCADE',
  "protocol_messages.protocol_messages_direction_check:CHECK(direction=ANY(ARRAY['inbound'::text,'outbound'::text]))",
  'delivery_attempts.delivery_attempts_pkey:PRIMARYKEY(id)',
  'delivery_attempts.delivery_attempts_message_id_fkey:FOREIGNKEY(message_id)REFERENCESprotocol_messages(id)ONDELETECASCADE',
  'delivery_attempts.delivery_attempts_attempt_check:CHECK(attempt>0)',
  "delivery_attempts.delivery_attempts_state_check:CHECK(state=ANY(ARRAY['pending'::text,'delivered'::text,'failed'::text,'dead_lettered'::text]))",
  'delivery_attempts.delivery_attempts_message_id_attempt_key:UNIQUE(message_id,attempt)',
  'webhook_subscriptions.webhook_subscriptions_pkey:PRIMARYKEY(id)',
  'webhook_subscriptions.webhook_subscriptions_api_client_id_fkey:FOREIGNKEY(api_client_id)REFERENCESapi_clients(id)ONDELETECASCADE',
  "webhook_subscriptions.webhook_subscriptions_event_types_check:CHECK(jsonb_typeof(event_types)='array'::text)",
  "webhook_subscriptions.webhook_subscriptions_status_check:CHECK(status=ANY(ARRAY['active'::text,'disabled'::text]))",
  'outbox_jobs.outbox_jobs_pkey:PRIMARYKEY(id)',
  "outbox_jobs.outbox_jobs_state_check:CHECK(state=ANY(ARRAY['pending'::text,'processing'::text,'delivered'::text,'failed'::text,'dead_lettered'::text]))",
  'webhook_delivery_attempts.webhook_delivery_attempts_pkey:PRIMARYKEY(id)',
  'webhook_delivery_attempts.webhook_delivery_attempts_outbox_job_id_fkey:FOREIGNKEY(outbox_job_id)REFERENCESoutbox_jobs(id)ONDELETECASCADE',
  'webhook_delivery_attempts.webhook_delivery_attempts_attempt_check:CHECK(attempt>0)',
  "webhook_delivery_attempts.webhook_delivery_attempts_state_check:CHECK(state=ANY(ARRAY['delivered'::text,'failed'::text,'dead_lettered'::text]))",
  'webhook_delivery_attempts.webhook_delivery_attempts_outbox_job_id_attempt_key:UNIQUE(outbox_job_id,attempt)',
  'audit_events.audit_events_pkey:PRIMARYKEY(id)',
  "audit_events.audit_events_actor_type_check:CHECK(actor_type=ANY(ARRAY['api_client'::text,'user'::text,'system'::text]))",
  'audit_events.audit_events_event_hash_key:UNIQUE(event_hash)',
  'encryption_reencryption_jobs.encryption_reencryption_jobs_pkey:PRIMARYKEY(id)',
  "encryption_reencryption_jobs.encryption_reencryption_jobs_state_check:CHECK(state=ANY(ARRAY['running'::text,'processing'::text,'completed'::text,'failed'::text]))",
  'encryption_reencryption_jobs.encryption_reencryption_jobs_target_index_check:CHECK(target_index>=0)',
  'encryption_reencryption_jobs.encryption_reencryption_jobs_processed_records_check:CHECK(processed_records>=0)',
  'encryption_reencryption_jobs.encryption_reencryption_jobs_created_by_user_id_fkey:FOREIGNKEY(created_by_user_id)REFERENCESauth_users(id)',
];

const ORCHESTRATION_INDEX_METADATA = {
  idx_api_client_credentials_client: indexMetadata({
    keys: [indexKey('api_client_id'), indexKey('created_at', { descending: true, nullsFirst: true })],
    table: 'api_client_credentials',
  }),
  idx_counterparties_trust: indexMetadata({
    keys: [indexKey('trust_state'), indexKey('updated_at', { descending: true, nullsFirst: true })],
    table: 'counterparties',
  }),
  idx_orchestration_transfers_client_created: indexMetadata({
    keys: [indexKey('api_client_id'), indexKey('created_at', { descending: true, nullsFirst: true })],
    table: 'orchestration_transfers',
  }),
  idx_orchestration_transfers_state: indexMetadata({
    keys: [indexKey('state'), indexKey('updated_at', { descending: true, nullsFirst: true })],
    table: 'orchestration_transfers',
  }),
  idx_compliance_cases_state: indexMetadata({ keys: [indexKey('state'), indexKey('updated_at', { descending: true, nullsFirst: true })], table: 'compliance_cases' }),
  idx_policy_decisions_case: indexMetadata({ keys: [indexKey('case_id'), indexKey('created_at', { descending: true, nullsFirst: true })], table: 'policy_decisions' }),
  idx_case_reviews_case: indexMetadata({ keys: [indexKey('case_id'), indexKey('created_at'), indexKey('id')], table: 'case_reviews' }),
  idx_protocol_exchanges_transfer: indexMetadata({
    keys: [indexKey('transfer_id'), indexKey('created_at', { descending: true, nullsFirst: true })],
    table: 'protocol_exchanges',
  }),
  idx_protocol_exchanges_compatibility: indexMetadata({
    keys: [indexKey('connector_key'), indexKey('compatibility_state'), indexKey('updated_at')],
    table: 'protocol_exchanges',
  }),
  idx_protocol_messages_exchange: indexMetadata({ keys: [indexKey('exchange_id'), indexKey('created_at', { descending: true, nullsFirst: true })], table: 'protocol_messages' }),
  idx_delivery_attempts_retry: indexMetadata({
    keys: [indexKey('state'), indexKey('next_attempt_at')],
    predicate: "(state = ANY (ARRAY['pending'::text, 'failed'::text]))",
    table: 'delivery_attempts',
  }),
  idx_webhook_subscriptions_client: indexMetadata({ keys: [indexKey('api_client_id'), indexKey('status')], table: 'webhook_subscriptions' }),
  idx_outbox_jobs_dispatch: indexMetadata({
    keys: [indexKey('state'), indexKey('next_attempt_at')],
    predicate: "(state = ANY (ARRAY['pending'::text, 'failed'::text]))",
    table: 'outbox_jobs',
  }),
  idx_webhook_delivery_attempts_job: indexMetadata({
    keys: [indexKey('outbox_job_id'), indexKey('attempt', { descending: true, nullsFirst: true })],
    table: 'webhook_delivery_attempts',
  }),
  idx_audit_events_aggregate: indexMetadata({ keys: [indexKey('aggregate_type'), indexKey('aggregate_id'), indexKey('id')], table: 'audit_events' }),
  idx_encryption_reencryption_single_active: indexMetadata({
    keys: [indexKey('true')],
    predicate: "(state = ANY (ARRAY['running'::text, 'processing'::text]))",
    table: 'encryption_reencryption_jobs',
    unique: true,
  }),
  idx_encryption_reencryption_created: indexMetadata({
    keys: [indexKey('created_at', { descending: true, nullsFirst: true }), indexKey('id', { descending: true, nullsFirst: true })],
    table: 'encryption_reencryption_jobs',
  }),
};

Object.assign(COLUMN_METADATA, ORCHESTRATION_COLUMN_METADATA);
Object.assign(INDEX_METADATA, ORCHESTRATION_INDEX_METADATA);

const canonicalRows = () => {
  const tables = [
    'error_logs',
    'auth_users',
    'auth_reset_password_tokens',
    'auth_action_history',
    'trp_configuration',
    'travel_rule_transfers',
    'travel_rule_email_jobs',
    'travel_rule_tokens',
    'travel_rule_messages',
    'travel_rule_events',
    ...ORCHESTRATION_TABLES,
  ];
  const columns = [
    'error_logs.id',
    'error_logs.created_at',
    'error_logs.function_name',
    'error_logs.message',
    'error_logs.url',
    'error_logs.details',
    'error_logs.status',
    'auth_users.id',
    'auth_users.email',
    'auth_users.password',
    'auth_users.role',
    'auth_users.is_active',
    'auth_users.session_version',
    'auth_users.created_at',
    'auth_reset_password_tokens.id',
    'auth_reset_password_tokens.user_id',
    'auth_reset_password_tokens.token_digest',
    'auth_reset_password_tokens.expires_at',
    'auth_reset_password_tokens.used_at',
    'auth_reset_password_tokens.created_at',
    'auth_action_history.id',
    'auth_action_history.user_id',
    'auth_action_history.action',
    'auth_action_history.data',
    'auth_action_history.created_at',
    'trp_configuration.name',
    'trp_configuration.value_encrypted',
    'trp_configuration.created_at',
    'trp_configuration.updated_at',
    'travel_rule_transfers.id',
    'travel_rule_transfers.protocol',
    'travel_rule_transfers.direction',
    'travel_rule_transfers.state',
    'travel_rule_transfers.asset_dti',
    'travel_rule_transfers.amount',
    'travel_rule_transfers.payload_encrypted',
    'travel_rule_transfers.operation_encrypted',
    'travel_rule_transfers.expires_at',
    'travel_rule_transfers.retention_until',
    'travel_rule_transfers.created_at',
    'travel_rule_transfers.updated_at',
    'travel_rule_email_jobs.id',
    'travel_rule_email_jobs.transfer_id',
    'travel_rule_email_jobs.recipient_email_encrypted',
    'travel_rule_email_jobs.token_encrypted',
    'travel_rule_email_jobs.token_digest',
    'travel_rule_email_jobs.status',
    'travel_rule_email_jobs.attempts',
    'travel_rule_email_jobs.next_attempt_at',
    'travel_rule_email_jobs.locked_at',
    'travel_rule_email_jobs.last_error_code',
    'travel_rule_email_jobs.created_by_user_id',
    'travel_rule_email_jobs.expires_at',
    'travel_rule_email_jobs.created_at',
    'travel_rule_email_jobs.updated_at',
    'travel_rule_email_jobs.sent_at',
    'travel_rule_email_jobs.consumed_at',
    'travel_rule_tokens.id',
    'travel_rule_tokens.transfer_id',
    'travel_rule_tokens.digest',
    'travel_rule_tokens.purpose',
    'travel_rule_tokens.expires_at',
    'travel_rule_tokens.consumed_at',
    'travel_rule_tokens.created_at',
    'travel_rule_messages.id',
    'travel_rule_messages.transfer_id',
    'travel_rule_messages.phase',
    'travel_rule_messages.direction',
    'travel_rule_messages.logical_identifier',
    'travel_rule_messages.request_identifier',
    'travel_rule_messages.peer_fingerprint',
    'travel_rule_messages.request_encrypted',
    'travel_rule_messages.response_encrypted',
    'travel_rule_messages.delivery_state',
    'travel_rule_messages.status_code',
    'travel_rule_messages.error_code',
    'travel_rule_messages.superseded_by',
    'travel_rule_messages.created_at',
    'travel_rule_messages.delivered_at',
    'travel_rule_events.id',
    'travel_rule_events.transfer_id',
    'travel_rule_events.event_type',
    'travel_rule_events.from_state',
    'travel_rule_events.to_state',
    'travel_rule_events.actor_user_id',
    'travel_rule_events.actor_email_encrypted',
    'travel_rule_events.actor_role',
    'travel_rule_events.metadata',
    'travel_rule_events.created_at',
    ...Object.keys(ORCHESTRATION_COLUMN_METADATA),
  ];
  const indexes = [
    'idx_error_logs_created_at',
    'idx_auth_users_active_created',
    'idx_auth_users_email_trgm',
    'idx_auth_action_history_user_id',
    'idx_auth_action_history_action_created',
    'idx_travel_rule_transfers_review',
    'idx_travel_rule_transfers_retention',
    'idx_travel_rule_email_jobs_dispatch',
    'idx_travel_rule_email_jobs_transfer_created',
    'idx_travel_rule_tokens_transfer_purpose',
    'idx_travel_rule_inbound_replay',
    'idx_travel_rule_messages_retry',
    'idx_travel_rule_events_transfer',
    ...Object.keys(ORCHESTRATION_INDEX_METADATA),
  ];
  const constraints = [
    { definition: 'PRIMARY KEY (id)', name: 'error_logs_pkey', table: 'error_logs' },
    { definition: 'PRIMARY KEY (id)', name: 'auth_users_pkey', table: 'auth_users' },
    { definition: 'UNIQUE (email)', name: 'auth_users_email_key', table: 'auth_users' },
    {
      definition:
        "CHECK (role = ANY (ARRAY['admin'::text, 'user'::text, 'platform_admin'::text, 'integration_operator'::text, 'compliance_reviewer'::text, 'compliance_approver'::text, 'auditor'::text]))",
      name: 'auth_users_role_check',
      table: 'auth_users',
    },
    { definition: 'PRIMARY KEY (id)', name: 'auth_reset_password_tokens_pkey', table: 'auth_reset_password_tokens' },
    { definition: 'FOREIGN KEY (user_id) REFERENCES auth_users(id)', name: 'auth_reset_password_tokens_user_id_fkey', table: 'auth_reset_password_tokens' },
    { definition: 'UNIQUE (token_digest)', name: 'auth_reset_password_tokens_token_digest_key', table: 'auth_reset_password_tokens' },
    { definition: 'PRIMARY KEY (id)', name: 'auth_action_history_pkey', table: 'auth_action_history' },
    { definition: 'FOREIGN KEY (user_id) REFERENCES auth_users(id)', name: 'auth_action_history_user_id_fkey', table: 'auth_action_history' },
    { definition: 'PRIMARY KEY (name)', name: 'trp_configuration_pkey', table: 'trp_configuration' },
    { definition: "CHECK (name = 'service_api_key'::text)", name: 'trp_configuration_name_check', table: 'trp_configuration' },
    { definition: 'PRIMARY KEY (id)', name: 'travel_rule_transfers_pkey', table: 'travel_rule_transfers' },
    { definition: "CHECK (protocol = 'TRP'::text)", name: 'travel_rule_transfers_protocol_check', table: 'travel_rule_transfers' },
    { definition: "CHECK (direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))", name: 'travel_rule_transfers_direction_check', table: 'travel_rule_transfers' },
    {
      definition: "CHECK (state = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'confirmed'::text, 'canceled'::text, 'expired'::text]))",
      name: 'travel_rule_transfers_state_check',
      table: 'travel_rule_transfers',
    },
    { definition: 'PRIMARY KEY (id)', name: 'travel_rule_email_jobs_pkey', table: 'travel_rule_email_jobs' },
    {
      definition: 'FOREIGN KEY (transfer_id) REFERENCES travel_rule_transfers(id) ON DELETE CASCADE',
      name: 'travel_rule_email_jobs_transfer_id_fkey',
      table: 'travel_rule_email_jobs',
    },
    { definition: 'UNIQUE (token_digest)', name: 'travel_rule_email_jobs_token_digest_key', table: 'travel_rule_email_jobs' },
    {
      definition: "CHECK (status = ANY (ARRAY['queued'::text, 'processing'::text, 'failed'::text, 'sent'::text, 'dead_lettered'::text, 'consumed'::text]))",
      name: 'travel_rule_email_jobs_status_check',
      table: 'travel_rule_email_jobs',
    },
    { definition: 'CHECK (attempts >= 0)', name: 'travel_rule_email_jobs_attempts_check', table: 'travel_rule_email_jobs' },
    {
      definition: 'FOREIGN KEY (created_by_user_id) REFERENCES auth_users(id)',
      name: 'travel_rule_email_jobs_created_by_user_id_fkey',
      table: 'travel_rule_email_jobs',
    },
    { definition: 'PRIMARY KEY (id)', name: 'travel_rule_tokens_pkey', table: 'travel_rule_tokens' },
    { definition: 'FOREIGN KEY (transfer_id) REFERENCES travel_rule_transfers(id) ON DELETE CASCADE', name: 'travel_rule_tokens_transfer_id_fkey', table: 'travel_rule_tokens' },
    { definition: 'UNIQUE (digest)', name: 'travel_rule_tokens_digest_key', table: 'travel_rule_tokens' },
    { definition: "CHECK (purpose = ANY (ARRAY['inquiry'::text, 'resolution'::text, 'confirmation'::text]))", name: 'travel_rule_tokens_purpose_check', table: 'travel_rule_tokens' },
    { definition: 'PRIMARY KEY (id)', name: 'travel_rule_messages_pkey', table: 'travel_rule_messages' },
    { definition: 'FOREIGN KEY (transfer_id) REFERENCES travel_rule_transfers(id) ON DELETE CASCADE', name: 'travel_rule_messages_transfer_id_fkey', table: 'travel_rule_messages' },
    { definition: 'FOREIGN KEY (superseded_by) REFERENCES travel_rule_messages(id)', name: 'travel_rule_messages_superseded_by_fkey', table: 'travel_rule_messages' },
    { definition: "CHECK (phase = ANY (ARRAY['inquiry'::text, 'resolution'::text, 'confirmation'::text]))", name: 'travel_rule_messages_phase_check', table: 'travel_rule_messages' },
    { definition: "CHECK (direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))", name: 'travel_rule_messages_direction_check', table: 'travel_rule_messages' },
    {
      definition: "CHECK (delivery_state = ANY (ARRAY['received'::text, 'pending'::text, 'delivered'::text, 'failed'::text]))",
      name: 'travel_rule_messages_delivery_state_check',
      table: 'travel_rule_messages',
    },
    { definition: 'PRIMARY KEY (id)', name: 'travel_rule_events_pkey', table: 'travel_rule_events' },
    { definition: 'FOREIGN KEY (transfer_id) REFERENCES travel_rule_transfers(id) ON DELETE CASCADE', name: 'travel_rule_events_transfer_id_fkey', table: 'travel_rule_events' },
  ];

  return [
    ...['pg_trgm', 'pgcrypto'].map(name => ({ kind: 'extension', name })),
    ...tables.map(name => ({ kind: 'table', name })),
    ...columns.map(name => ({ kind: 'column', metadata: COLUMN_METADATA[name], name })),
    ...indexes.map(name => ({ kind: 'index', metadata: INDEX_METADATA[name], name })),
    ...constraints.map(constraint => ({ kind: 'constraint', name: normalizeConstraint(constraint) })),
    ...ORCHESTRATION_CONSTRAINTS.map(name => ({ kind: 'constraint', name })),
  ];
};

const createPool = rows => ({ query: jest.fn().mockResolvedValue({ rows }) });

const createPostgresParsingPool = rows => ({
  query: jest.fn().mockImplementation(query => {
    if (/\bAS\s+constraint\b/i.test(query)) {
      return Promise.reject(new Error('syntax error at or near "constraint"'));
    }

    return Promise.resolve({ rows });
  }),
});

test('submits a PostgreSQL-safe canonical metadata query', async () => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const databasePool = createPostgresParsingPool(canonicalRows());

  await expect(assertCanonicalSchema(databasePool)).resolves.toBeUndefined();
});

test('accepts the complete canonical fresh-install schema manifest', async () => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const databasePool = createPool(canonicalRows());

  await expect(assertCanonicalSchema(databasePool)).resolves.toBeUndefined();

  expect(databasePool.query).toHaveBeenCalledTimes(1);
  expect(databasePool.query.mock.calls[0][0].trim()).toMatch(/^SELECT /);
  expect(databasePool.query.mock.calls[0][0].trim()).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i);
  expect(databasePool.query.mock.calls[0][0]).toMatch(/FROM pg_constraint/);
  expect(databasePool.query.mock.calls[0][0]).toMatch(/extname::text AS name/);
  expect(databasePool.query.mock.calls[0][0]).toMatch(/format_type\(attribute\.atttypid, attribute\.atttypmod\)/);
  expect(databasePool.query.mock.calls[0][0]).toMatch(/FROM pg_index/);
  expect(databasePool.query.mock.calls[0][0]).toMatch(/pg_get_indexdef/);
  expect(databasePool.query.mock.calls[0][0]).toMatch(/pg_opclass/);
  expect(databasePool.query.mock.calls[0][0]).toMatch(/index_metadata\.indoption/);
  expect(databasePool.query.mock.calls[0][0]).toMatch(/index_metadata\.indisvalid/);
  expect(databasePool.query.mock.calls[0][0]).toMatch(/index_metadata\.indisready/);
});

test.each([
  ['extension', 'pgcrypto'],
  ['table', 'travel_rule_events'],
  ['table', 'travel_rule_email_jobs'],
  ['column', 'travel_rule_email_jobs.token_digest'],
  ['index', 'idx_travel_rule_email_jobs_dispatch'],
  ['column', 'auth_users.session_version'],
  ['index', 'idx_travel_rule_inbound_replay'],
])('rejects a canonical schema missing required %s metadata', async (kind, name) => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const databasePool = createPool(canonicalRows().filter(row => row.kind !== kind || row.name !== name));

  await expect(assertCanonicalSchema(databasePool)).rejects.toThrow('Database schema is not canonical.');
});

test.each([
  ['column', 'auth_reset_password_tokens.expires_at', { defaultExpression: "now() + '1 day'::interval" }],
  ['index', 'idx_travel_rule_inbound_replay', { predicate: "direction = 'inbound'::text" }],
])('accepts PostgreSQL %s expression deparsing without redundant wrapping parentheses', async (kind, name, mutation) => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const databasePool = createPool(canonicalRows().map(row => (row.kind === kind && row.name === name ? { ...row, metadata: { ...row.metadata, ...mutation } } : row)));

  await expect(assertCanonicalSchema(databasePool)).resolves.toBeUndefined();
});

test('rejects a canonical schema missing a required foreign-key constraint', async () => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const missingConstraint = normalizeConstraint({
    definition: 'FOREIGN KEY (transfer_id) REFERENCES travel_rule_transfers(id) ON DELETE CASCADE',
    name: 'travel_rule_tokens_transfer_id_fkey',
    table: 'travel_rule_tokens',
  });
  const databasePool = createPool(canonicalRows().filter(row => row.kind !== 'constraint' || row.name !== missingConstraint));

  await expect(assertCanonicalSchema(databasePool)).rejects.toThrow('Database schema is not canonical.');
});

test.each([
  ['data type', { dataType: 'bigint' }],
  ['not-null flag', { notNull: false }],
  ['default expression', { defaultExpression: null }],
])('rejects auth_users.session_version with incompatible %s metadata', async (_description, mutation) => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const databasePool = createPool(canonicalRows().map(row => (row.kind === 'column' && row.name === 'auth_users.session_version' ? { ...row, metadata: { ...row.metadata, ...mutation } } : row)));

  await expect(assertCanonicalSchema(databasePool)).rejects.toThrow('Database schema is not canonical.');
});

test('rejects a required identity column without canonical identity metadata', async () => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const databasePool = createPool(canonicalRows().map(row => (row.kind === 'column' && row.name === 'auth_users.id' ? { ...row, metadata: { ...row.metadata, identity: '' } } : row)));

  await expect(assertCanonicalSchema(databasePool)).rejects.toThrow('Database schema is not canonical.');
});

test.each([
  ['table', { table: 'travel_rule_transfers' }],
  ['access method', { method: 'hash' }],
  ['key definition', { keys: [indexKey('request_identifier')] }],
  ['uniqueness', { unique: false }],
  ['predicate', { predicate: null }],
  ['valid state', { valid: false }],
  ['ready state', { ready: false }],
])('rejects a same-name inbound replay index replacement with incompatible %s', async (_description, mutation) => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const databasePool = createPool(canonicalRows().map(row => (row.kind === 'index' && row.name === 'idx_travel_rule_inbound_replay' ? { ...row, metadata: { ...row.metadata, ...mutation } } : row)));

  await expect(assertCanonicalSchema(databasePool)).rejects.toThrow('Database schema is not canonical.');
});

test('rejects a same-name GIN index replacement missing the canonical trigram opclass', async () => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const databasePool = createPool(
    canonicalRows().map(row => (row.kind === 'index' && row.name === 'idx_auth_users_email_trgm' ? { ...row, metadata: { ...row.metadata, keys: [indexKey('email')] } } : row)),
  );

  await expect(assertCanonicalSchema(databasePool)).rejects.toThrow('Database schema is not canonical.');
});

test('rejects a canonical constraint whose check definition was weakened', async () => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const expectedConstraint = normalizeConstraint({
    definition:
      "CHECK (role = ANY (ARRAY['admin'::text, 'user'::text, 'platform_admin'::text, 'integration_operator'::text, 'compliance_reviewer'::text, 'compliance_approver'::text, 'auditor'::text]))",
    name: 'auth_users_role_check',
    table: 'auth_users',
  });
  const mutatedConstraint = normalizeConstraint({
    definition: "CHECK (role = ANY (ARRAY['admin'::text, 'user'::text, 'super_admin'::text]))",
    name: 'auth_users_role_check',
    table: 'auth_users',
  });
  const databasePool = createPool(canonicalRows().map(row => (row.name === expectedConstraint ? { ...row, name: mutatedConstraint } : row)));

  await expect(assertCanonicalSchema(databasePool)).rejects.toThrow('Database schema is not canonical.');
});

test("rejects a protocol check whose literal changed from 'TRP' to 'trp'", async () => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const canonicalConstraint = normalizeConstraint({
    definition: "CHECK (protocol = 'TRP'::text)",
    name: 'travel_rule_transfers_protocol_check',
    table: 'travel_rule_transfers',
  });
  const lowercaseLiteralConstraint = canonicalConstraint.replace("'TRP'", "'trp'");
  const databasePool = createPool(canonicalRows().map(row => (row.name === canonicalConstraint ? { ...row, name: lowercaseLiteralConstraint } : row)));

  await expect(assertCanonicalSchema(databasePool)).rejects.toThrow('Database schema is not canonical.');
});

test.each([
  { kind: 'column', name: 'auth_reset_password_tokens.token' },
  { kind: 'table', name: 'auth_apikey' },
])('rejects forbidden legacy %s metadata', async legacy => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const databasePool = createPool([...canonicalRows(), legacy]);

  await expect(assertCanonicalSchema(databasePool)).rejects.toThrow('Database schema is not canonical.');
});

test('rejects the stale schema_migrations table', async () => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const databasePool = createPool([...canonicalRows(), { kind: 'table', name: 'schema_migrations' }]);

  await expect(assertCanonicalSchema(databasePool)).rejects.toThrow('Database schema is not canonical.');
});

test.each([
  ['column', 'orchestration_transfers.operation_encrypted'],
  ['constraint', 'case_reviews.case_reviews_case_version_check:CHECK(case_version>=0)'],
  ['index', 'idx_protocol_exchanges_compatibility'],
])('rejects incomplete orchestration %s metadata', async (kind, name) => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const databasePool = createPool(canonicalRows().filter(row => row.kind !== kind || row.name !== name));

  await expect(assertCanonicalSchema(databasePool)).rejects.toThrow('Database schema is not canonical.');
});

test('sanitizes PostgreSQL metadata query failures', async () => {
  const { assertCanonicalSchema } = await loadSchemaBootstrap();
  const databasePool = { query: jest.fn().mockRejectedValue(new Error('postgres://defy:secret@postgres/private')) };

  await expect(assertCanonicalSchema(databasePool)).rejects.toThrow('Database schema is not canonical.');
  await expect(assertCanonicalSchema(databasePool)).rejects.not.toThrow('postgres://');
});
