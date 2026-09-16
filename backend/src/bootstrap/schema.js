const REQUIRED_METADATA = {
  constraint: [
    'error_logs.error_logs_pkey:PRIMARYKEY(id)',
    'auth_users.auth_users_pkey:PRIMARYKEY(id)',
    'auth_users.auth_users_email_key:UNIQUE(email)',
    [
      "auth_users.auth_users_role_check:CHECK(role=ANY(ARRAY['admin'::text,'user'::text,'platform_admin'::text,",
      "'integration_operator'::text,'compliance_reviewer'::text,'compliance_approver'::text,'auditor'::text]))",
    ].join(''),
    'auth_reset_password_tokens.auth_reset_password_tokens_pkey:PRIMARYKEY(id)',
    'auth_reset_password_tokens.auth_reset_password_tokens_user_id_fkey:FOREIGNKEY(user_id)REFERENCESauth_users(id)',
    'auth_reset_password_tokens.auth_reset_password_tokens_token_digest_key:UNIQUE(token_digest)',
    'auth_action_history.auth_action_history_pkey:PRIMARYKEY(id)',
    'auth_action_history.auth_action_history_user_id_fkey:FOREIGNKEY(user_id)REFERENCESauth_users(id)',
    'trp_configuration.trp_configuration_pkey:PRIMARYKEY(name)',
    "trp_configuration.trp_configuration_name_check:CHECK(name='service_api_key'::text)",
    'travel_rule_transfers.travel_rule_transfers_pkey:PRIMARYKEY(id)',
    "travel_rule_transfers.travel_rule_transfers_protocol_check:CHECK(protocol='TRP'::text)",
    "travel_rule_transfers.travel_rule_transfers_direction_check:CHECK(direction=ANY(ARRAY['inbound'::text,'outbound'::text]))",
    "travel_rule_transfers.travel_rule_transfers_state_check:CHECK(state=ANY(ARRAY['pending'::text,'approved'::text,'rejected'::text,'confirmed'::text,'canceled'::text,'expired'::text]))",
    'travel_rule_email_jobs.travel_rule_email_jobs_pkey:PRIMARYKEY(id)',
    'travel_rule_email_jobs.travel_rule_email_jobs_transfer_id_fkey:FOREIGNKEY(transfer_id)REFERENCEStravel_rule_transfers(id)ONDELETECASCADE',
    'travel_rule_email_jobs.travel_rule_email_jobs_token_digest_key:UNIQUE(token_digest)',
    "travel_rule_email_jobs.travel_rule_email_jobs_status_check:CHECK(status=ANY(ARRAY['queued'::text,'processing'::text,'failed'::text,'sent'::text,'dead_lettered'::text,'consumed'::text]))",
    'travel_rule_email_jobs.travel_rule_email_jobs_attempts_check:CHECK(attempts>=0)',
    'travel_rule_email_jobs.travel_rule_email_jobs_created_by_user_id_fkey:FOREIGNKEY(created_by_user_id)REFERENCESauth_users(id)',
    'travel_rule_tokens.travel_rule_tokens_pkey:PRIMARYKEY(id)',
    'travel_rule_tokens.travel_rule_tokens_transfer_id_fkey:FOREIGNKEY(transfer_id)REFERENCEStravel_rule_transfers(id)ONDELETECASCADE',
    'travel_rule_tokens.travel_rule_tokens_digest_key:UNIQUE(digest)',
    "travel_rule_tokens.travel_rule_tokens_purpose_check:CHECK(purpose=ANY(ARRAY['inquiry'::text,'resolution'::text,'confirmation'::text]))",
    'travel_rule_messages.travel_rule_messages_pkey:PRIMARYKEY(id)',
    'travel_rule_messages.travel_rule_messages_transfer_id_fkey:FOREIGNKEY(transfer_id)REFERENCEStravel_rule_transfers(id)ONDELETECASCADE',
    'travel_rule_messages.travel_rule_messages_superseded_by_fkey:FOREIGNKEY(superseded_by)REFERENCEStravel_rule_messages(id)',
    "travel_rule_messages.travel_rule_messages_phase_check:CHECK(phase=ANY(ARRAY['inquiry'::text,'resolution'::text,'confirmation'::text]))",
    "travel_rule_messages.travel_rule_messages_direction_check:CHECK(direction=ANY(ARRAY['inbound'::text,'outbound'::text]))",
    "travel_rule_messages.travel_rule_messages_delivery_state_check:CHECK(delivery_state=ANY(ARRAY['received'::text,'pending'::text,'delivered'::text,'failed'::text]))",
    'travel_rule_events.travel_rule_events_pkey:PRIMARYKEY(id)',
    'travel_rule_events.travel_rule_events_transfer_id_fkey:FOREIGNKEY(transfer_id)REFERENCEStravel_rule_transfers(id)ONDELETECASCADE',
  ],
  column: [
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
  ],
  extension: ['pg_trgm', 'pgcrypto'],
  index: [
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
  ],
  table: [
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
  ],
};

const columnMetadata = (dataType, { defaultExpression = null, identity = '', notNull = false } = {}) => {
  return { dataType, defaultExpression, identity, notNull };
};

const REQUIRED_COLUMN_METADATA = {
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

const indexMetadata = ({ keys, table, method = 'btree', predicate = null, unique = false }) => {
  return { keys, method, predicate, ready: true, table, unique, valid: true };
};

const indexKey = (definition, { descending = false, nullsFirst = false, opclass = null } = {}) => {
  return { definition, descending, nullsFirst, opclass };
};

const REQUIRED_INDEX_METADATA = {
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

REQUIRED_METADATA.table.push(...ORCHESTRATION_TABLES);
REQUIRED_METADATA.column.push(...Object.keys(ORCHESTRATION_COLUMN_METADATA));
REQUIRED_METADATA.constraint.push(...ORCHESTRATION_CONSTRAINTS);
REQUIRED_METADATA.index.push(...Object.keys(ORCHESTRATION_INDEX_METADATA));
Object.assign(REQUIRED_COLUMN_METADATA, ORCHESTRATION_COLUMN_METADATA);
Object.assign(REQUIRED_INDEX_METADATA, ORCHESTRATION_INDEX_METADATA);

const FORBIDDEN_METADATA = {
  column: ['auth_users.key', 'auth_users.verified', 'auth_reset_password_tokens.token'],
  table: ['auth_apikey', 'auth_usage', 'schema_migrations'],
};

const SCHEMA_METADATA_QUERY = `
  SELECT 'extension' AS kind, extname::text AS name, NULL::jsonb AS metadata
  FROM pg_extension
  UNION ALL
  SELECT 'table' AS kind, relation.relname AS name, NULL::jsonb AS metadata
  FROM pg_class AS relation
  INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = current_schema() AND relation.relkind = 'r'
  UNION ALL
  SELECT
    'column' AS kind,
    relation.relname || '.' || attribute.attname AS name,
    jsonb_build_object(
      'dataType', format_type(attribute.atttypid, attribute.atttypmod),
      'notNull', attribute.attnotnull,
      'defaultExpression', pg_get_expr(default_value.adbin, default_value.adrelid, TRUE),
      'identity', attribute.attidentity
    ) AS metadata
  FROM pg_attribute AS attribute
  INNER JOIN pg_class AS relation ON relation.oid = attribute.attrelid
  INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  LEFT JOIN pg_attrdef AS default_value ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
  WHERE namespace.nspname = current_schema() AND relation.relkind = 'r' AND attribute.attnum > 0 AND NOT attribute.attisdropped
  UNION ALL
  SELECT
    'index' AS kind,
    index_relation.relname AS name,
    jsonb_build_object(
      'table', table_relation.relname,
      'method', access_method.amname,
      'keys', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'definition', pg_get_indexdef(index_relation.oid, key_position.position, TRUE),
            'opclass', CASE WHEN operator_class.opcdefault THEN NULL ELSE operator_class.opcname END,
            'descending', (index_metadata.indoption[key_position.position - 1] & 1) = 1,
            'nullsFirst', (index_metadata.indoption[key_position.position - 1] & 2) = 2
          )
          ORDER BY key_position.position
        )
        FROM generate_series(1, index_metadata.indnkeyatts) AS key_position(position)
        INNER JOIN pg_opclass AS operator_class ON operator_class.oid = index_metadata.indclass[key_position.position - 1]
      ),
      'unique', index_metadata.indisunique,
      'predicate', pg_get_expr(index_metadata.indpred, index_metadata.indrelid, TRUE),
      'valid', index_metadata.indisvalid,
      'ready', index_metadata.indisready
    ) AS metadata
  FROM pg_index AS index_metadata
  INNER JOIN pg_class AS index_relation ON index_relation.oid = index_metadata.indexrelid
  INNER JOIN pg_class AS table_relation ON table_relation.oid = index_metadata.indrelid
  INNER JOIN pg_namespace AS namespace ON namespace.oid = table_relation.relnamespace
  INNER JOIN pg_am AS access_method ON access_method.oid = index_relation.relam
  WHERE namespace.nspname = current_schema() AND table_relation.relkind = 'r'
  UNION ALL
  SELECT
    'constraint' AS kind,
    relation.relname || '.' || constraint_metadata.conname || ':' || regexp_replace(pg_get_constraintdef(constraint_metadata.oid, TRUE), '\\s+', '', 'g') AS name,
    NULL::jsonb AS metadata
  FROM pg_constraint AS constraint_metadata
  INNER JOIN pg_class AS relation ON relation.oid = constraint_metadata.conrelid
  INNER JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = current_schema() AND constraint_metadata.contype IN ('p', 'u', 'f', 'c')
`;

const schemaError = () => {
  return new Error('Database schema is not canonical.');
};

const containsAll = (actualMetadata, requiredMetadata) => {
  return requiredMetadata.every(name => {
    return actualMetadata.has(name);
  });
};

const containsAny = (actualMetadata, forbiddenMetadata = []) => {
  return forbiddenMetadata.some(name => {
    return actualMetadata.has(name);
  });
};

const stripWrappingParentheses = expression => {
  let normalized = expression;

  while (normalized.startsWith('(') && normalized.endsWith(')')) {
    let depth = 0;
    let quote = null;
    let wrapsExpression = true;

    for (let position = 0; position < normalized.length; position += 1) {
      const character = normalized[position];

      if (quote) {
        if (character === quote) {
          if (normalized[position + 1] === quote) {
            position += 1;
          } else {
            quote = null;
          }
        }
      } else if (character === "'" || character === '"') {
        quote = character;
      } else if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;

        if (depth === 0 && position < normalized.length - 1) {
          wrapsExpression = false;
          break;
        }
      }
    }

    if (!wrapsExpression || depth !== 0 || quote) {
      break;
    }

    normalized = normalized.slice(1, -1);
  }

  return normalized;
};

const normalizeSqlExpression = expression => {
  if (typeof expression !== 'string') {
    return expression;
  }

  let normalized = '';
  let quote = null;

  for (let position = 0; position < expression.length; position += 1) {
    const character = expression[position];

    if (quote) {
      normalized += character;

      if (character === quote) {
        if (expression[position + 1] === quote) {
          normalized += expression[position + 1];
          position += 1;
        } else {
          quote = null;
        }
      }
    } else if (character === "'" || character === '"') {
      quote = character;
      normalized += character;
    } else if (!/\s/.test(character)) {
      normalized += character;
    }
  }

  return stripWrappingParentheses(normalized);
};

const indexKeyMatches = (actual, expected) => {
  return (
    actual &&
    typeof actual === 'object' &&
    normalizeSqlExpression(actual.definition) === normalizeSqlExpression(expected.definition) &&
    actual.opclass === expected.opclass &&
    actual.descending === expected.descending &&
    actual.nullsFirst === expected.nullsFirst
  );
};

const metadataValueMatches = (field, actual, expected) => {
  if (field === 'keys') {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      actual.every((value, index) => {
        return indexKeyMatches(value, expected[index]);
      })
    );
  }

  if (field === 'defaultExpression' || field === 'definition' || field === 'predicate') {
    return normalizeSqlExpression(actual) === normalizeSqlExpression(expected);
  }

  return actual === expected;
};

const metadataMatches = (actual, expected) => {
  if (!actual || typeof actual !== 'object') {
    return false;
  }

  return Object.entries(expected).every(([field, expectedValue]) => {
    return metadataValueMatches(field, actual[field], expectedValue);
  });
};

const containsCanonicalMetadata = (actualMetadata, requiredMetadata) => {
  return Object.entries(requiredMetadata).every(([name, expected]) => {
    return metadataMatches(actualMetadata.get(name), expected);
  });
};

const metadataManifestIsComplete = (requiredNames, requiredMetadata) => {
  const metadataNames = Object.keys(requiredMetadata);

  return (
    metadataNames.length === requiredNames.length &&
    requiredNames.every(name => {
      return Object.hasOwn(requiredMetadata, name);
    })
  );
};

const assertCanonicalSchema = async databasePool => {
  try {
    const result = await databasePool.query(SCHEMA_METADATA_QUERY);
    const metadata = result.rows.reduce(
      (collected, row) => {
        if (collected[row.kind]) {
          collected[row.kind].set(row.name, row.metadata);
        }

        return collected;
      },
      { column: new Map(), constraint: new Map(), extension: new Map(), index: new Map(), table: new Map() },
    );
    const missingRequiredMetadata = Object.entries(REQUIRED_METADATA).some(([kind, requiredMetadata]) => {
      return !containsAll(metadata[kind], requiredMetadata);
    });
    const hasIncompatibleMetadata =
      !metadataManifestIsComplete(REQUIRED_METADATA.column, REQUIRED_COLUMN_METADATA) ||
      !metadataManifestIsComplete(REQUIRED_METADATA.index, REQUIRED_INDEX_METADATA) ||
      !containsCanonicalMetadata(metadata.column, REQUIRED_COLUMN_METADATA) ||
      !containsCanonicalMetadata(metadata.index, REQUIRED_INDEX_METADATA);
    const hasForbiddenMetadata = Object.entries(FORBIDDEN_METADATA).some(([kind, forbiddenMetadata]) => {
      return containsAny(metadata[kind], forbiddenMetadata);
    });

    if (missingRequiredMetadata || hasIncompatibleMetadata || hasForbiddenMetadata) {
      throw schemaError();
    }
  } catch (_error) {
    throw schemaError();
  }
};

export { assertCanonicalSchema };
