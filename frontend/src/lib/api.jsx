import axios from "axios";
import i18n from "@/i18n/config";

const api = axios.create({
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30000,
  withCredentials: true,
});

const updatesApi = axios.create({
  baseURL: "https://api.getdefy.co",
  headers: { "Content-Type": "application/json" },
  timeout: 30000,
  withCredentials: false,
});

export const submitUpdateRequest = async (email) => {
  let response;
  try {
    response = await updatesApi.post("/contact/create", {
      email: email.trim(),
      subject: "Travel Rule Playground updates",
      message: "I would like to receive updates about Travel Rule Playground at this email address.",
    });
  } catch (error) {
    const status = error.response?.status;
    let key = "failed";
    if (status === 400) key = "invalid";
    else if (status === 429) key = "rateLimited";
    else if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") key = "timeout";
    else if (!error.response) key = "connection";
    throw new Error(i18n.t(`errors:updates.${key}`));
  }
  if (response.status !== 200 || response.data?.code !== 0 || response.data?.data !== null || response.data?.message !== "OK") {
    throw new Error(i18n.t("errors:updates.failed"));
  }
  return true;
};

const UNSAFE_METHODS = new Set(["delete", "patch", "post", "put"]);
const PUBLIC_UNAUTHENTICATED_PATHS = new Set(["/login", "/travel-rule/shared"]);
export const shouldRedirectUnauthorized = (pathname) => !PUBLIC_UNAUTHENTICATED_PATHS.has(pathname);

const readCookie = (name) => {
  const cookieHeader = globalThis.document?.cookie;

  if (!cookieHeader) {
    return null;
  }

  const prefix = `${name}=`;
  const part = cookieHeader.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));

  return part ? decodeURIComponent(part.slice(prefix.length)) : null;
};

api.interceptors.request.use(
  (config) => {
    const csrfToken = UNSAFE_METHODS.has(config.method?.toLowerCase()) ? readCookie("defy_csrf") : null;

    if (csrfToken && !config.headers["X-CSRF-Token"]) {
      config.headers["X-CSRF-Token"] = csrfToken;
    }

    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("authToken");

      if (typeof window !== "undefined" && shouldRedirectUnauthorized(window.location.pathname)) {
        // This interceptor runs outside React and cannot access the App Router.
        /* istanbul ignore next -- JSDOM cannot observe Location.assign; Chrome QA covers this redirect. */
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/login");
      }
    }

    return Promise.reject(error);
  },
);

const request = async (operation, fallbackKey) => {
  try {
    return await operation();
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message || i18n.t(fallbackKey);
    const normalizedError = new Error(errorMessage);

    if (typeof error.response?.status === "number") {
      normalizedError.status = error.response.status;
    }

    throw normalizedError;
  }
};

const TRP_INQUIRY_STATES = new Set(["pending", "approved", "rejected", "confirmed", "canceled", "expired"]);
const TRP_DIRECTIONS = new Set(["inbound", "outbound"]);
const TRP_MESSAGE_PHASES = new Set(["inquiry", "resolution", "confirmation"]);
const TRP_DELIVERY_STATES = new Set(["received", "delivered", "pending", "failed"]);
const TRP_EMAIL_STATES = new Set(["consumed", "dead_lettered", "expired", "failed", "processing", "queued", "sent"]);
const TRP_EVENT_TYPES = new Set([
  "created", "inquiry_approved", "inquiry_received", "inquiry_rejected", "manual_approval", "manual_rejection",
  "outbound_transfer_created", "transfer_canceled", "transfer_confirmed", "transfer_expired", "travel_address_created",
]);
const TRP_MANAGEMENT_RESOURCES = new Set(["transfers", "messages", "tokens", "events"]);
const TRP_MANAGEMENT_FILTERS = {
  transfers: { direction: TRP_DIRECTIONS, state: TRP_INQUIRY_STATES },
  messages: { direction: TRP_DIRECTIONS, phase: TRP_MESSAGE_PHASES, delivery_state: TRP_DELIVERY_STATES },
  tokens: { purpose: TRP_MESSAGE_PHASES, status: new Set(["active", "consumed", "expired"]) },
  events: { event_type: TRP_EVENT_TYPES, from_state: TRP_INQUIRY_STATES, to_state: TRP_INQUIRY_STATES },
};
const API_CLIENT_SCOPES = new Set(["transfers:read", "transfers:write", "webhooks:manage"]);
const API_CLIENT_STATUSES = new Set(["active", "disabled"]);
const EMAIL_MODES = new Set(["disabled", "smtp"]);
const COMPLIANCE_CASE_STATES = new Set(["approved", "escalated", "expired", "needs_information", "pending", "rejected"]);
const ORCHESTRATION_TRANSFER_STATES = new Set(["canceled", "created", "on_hold", "ready", "released", "returned", "settled"]);
const PROTOCOL_EXCHANGE_STATES = new Set(["awaiting_counterparty", "canceled", "completed", "dead_lettered", "delivering", "failed", "queued"]);
const REQUIRED_APPROVALS = new Set(["compliance_approver", "compliance_reviewer", "none"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]*$/;
const POSTGRES_BIGINT_MAX = 9223372036854775807n;
const TRANSFER_FIELDS = ["id", "protocol", "direction", "state", "asset_dti", "amount", "expires_at", "retention_until", "created_at", "updated_at"];
const MESSAGE_FIELDS = ["id", "transfer_id", "phase", "direction", "logical_identifier", "request_identifier", "delivery_state", "status_code", "error_code", "superseded_by", "created_at", "delivered_at"];
const TOKEN_FIELDS = ["id", "transfer_id", "purpose", "expires_at", "consumed_at", "created_at"];
const EVENT_FIELDS = ["id", "transfer_id", "event_type", "from_state", "to_state", "actor_user_id", "actor_role", "created_at"];
const EMAIL_JOB_FIELDS = ["attempts", "consumed_at", "created_at", "expires_at", "id", "last_error_code", "recipient_email", "sent_at", "status", "transfer_id", "updated_at"];

const isNullableString = (value) => value === null || typeof value === "string";
const isRecord = (value) => value && !Array.isArray(value) && typeof value === "object";
const isUuid = (value) => typeof value === "string" && UUID_PATTERN.test(value);
const isIsoTimestamp = (value) => (
  typeof value === "string"
  && ISO_TIMESTAMP_PATTERN.test(value)
  && Number.isFinite(Date.parse(value))
);
const isNullableIsoTimestamp = (value) => value === null || isIsoTimestamp(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const hasExactKeys = (value, fields) => isRecord(value) && Object.keys(value).length === fields.length && Object.keys(value).every((key) => fields.includes(key));
const isPositiveBigintString = (value) => typeof value === "string" && POSITIVE_DECIMAL_PATTERN.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX;

const isValidCaseExchange = (exchange, includeConnector) => (
  exchange === null
  || (
    isRecord(exchange)
    && isUuid(exchange.id)
    && PROTOCOL_EXCHANGE_STATES.has(exchange.state)
    && (!includeConnector || typeof exchange.connector === "string")
  )
);

const isValidComplianceCase = (item, listItem = false) => (
  isRecord(item)
  && isUuid(item.id)
  && isUuid(item.transfer_id)
  && typeof item.external_id === "string"
  && COMPLIANCE_CASE_STATES.has(item.state)
  && ORCHESTRATION_TRANSFER_STATES.has(item.transfer_state)
  && REQUIRED_APPROVALS.has(item.required_approval)
  && Number.isSafeInteger(item.version)
  && item.version >= 0
  && isValidCaseExchange(item.exchange, listItem)
  && (!listItem || (typeof item.created_at === "string" && typeof item.updated_at === "string"))
);

const isValidComplianceCaseList = (result) => (
  isRecord(result)
  && Array.isArray(result.data)
  && result.data.every((item) => isValidComplianceCase(item, true))
  && isCount(result.total)
  && Number.isSafeInteger(result.page)
  && result.page > 0
  && Number.isSafeInteger(result.limit)
  && result.limit > 0
);

const isValidCaseDecisionResult = (result) => (
  isRecord(result)
  && COMPLIANCE_CASE_STATES.has(result.case_state)
  && ORCHESTRATION_TRANSFER_STATES.has(result.transfer_state)
  && Number.isSafeInteger(result.version)
  && result.version > 0
);

const isValidInquiryListItem = (inquiry) => (
  inquiry &&
  !Array.isArray(inquiry) &&
  typeof inquiry === "object" &&
  typeof inquiry.id === "string" &&
  UUID_PATTERN.test(inquiry.id) &&
  TRP_INQUIRY_STATES.has(inquiry.state) &&
  isNullableString(inquiry.asset_dti) &&
  isNullableString(inquiry.amount) &&
  isNullableString(inquiry.expires_at) &&
  typeof inquiry.created_at === "string" &&
  typeof inquiry.updated_at === "string"
);

const isValidInquiryList = (result) => (
  result &&
  !Array.isArray(result) &&
  typeof result === "object" &&
  Array.isArray(result.data) &&
  result.data.every(isValidInquiryListItem) &&
  Number.isSafeInteger(result.total) &&
  result.total >= 0 &&
  Number.isSafeInteger(result.page) &&
  result.page > 0 &&
  Number.isSafeInteger(result.limit) &&
  result.limit > 0
);

const isValidInquiryDetail = (inquiry) => (
  inquiry &&
  !Array.isArray(inquiry) &&
  typeof inquiry === "object" &&
  typeof inquiry.id === "string" &&
  UUID_PATTERN.test(inquiry.id) &&
  inquiry.protocol === "TRP" &&
  inquiry.direction === "inbound" &&
  TRP_INQUIRY_STATES.has(inquiry.state) &&
  (inquiry.asset === null || (typeof inquiry.asset === "object" && !Array.isArray(inquiry.asset) && typeof inquiry.asset.dti === "string")) &&
  isNullableString(inquiry.amount) &&
  isNullableString(inquiry.expires_at) &&
  typeof inquiry.created_at === "string" &&
  typeof inquiry.updated_at === "string" &&
  (inquiry.ivms101 === null || (typeof inquiry.ivms101 === "object" && !Array.isArray(inquiry.ivms101)))
);

const isValidInquiryDecision = (result) => (
  result &&
  !Array.isArray(result) &&
  typeof result === "object" &&
  typeof result.id === "string" &&
  TRP_INQUIRY_STATES.has(result.state) &&
  typeof result.retryable === "boolean"
);

const isValidUser = (user) => (
  user &&
  !Array.isArray(user) &&
  typeof user === "object" &&
  typeof user.email === "string" &&
  user.email.trim() !== "" &&
  MANAGED_USER_ROLES.has(user.role) &&
  typeof user.created_at === "string" &&
  user.created_at.trim() !== ""
);

const MANAGED_USER_ROLES = new Set(["admin", "auditor", "compliance_approver", "compliance_reviewer", "integration_operator", "platform_admin", "user"]);

const isValidManagedUser = (user) => (
  user &&
  !Array.isArray(user) &&
  typeof user === "object" &&
  typeof user.email === "string" &&
  user.email.trim() !== "" &&
  MANAGED_USER_ROLES.has(user.role) &&
  typeof user.active === "boolean" &&
  typeof user.created_at === "string" &&
  user.created_at.trim() !== ""
);

const isValidManagedUserListResponse = (response) => (
  response &&
  !Array.isArray(response) &&
  typeof response === "object" &&
  response.code === 0 &&
  response.message === "OK" &&
  Array.isArray(response.data) &&
  response.data.every(isValidManagedUser) &&
  Number.isSafeInteger(response.page_count) &&
  response.page_count >= 0
);

const isValidManagedUserMutationResponse = (response) => (
  response &&
  !Array.isArray(response) &&
  typeof response === "object" &&
  response.code === 0 &&
  response.message === "OK" &&
  response.data === null
);

const managedUserPayload = ({ email, role } = {}) => {
  const payload = { email };

  if (role !== undefined) {
    if (!MANAGED_USER_ROLES.has(role)) {
      throw new Error(i18n.t("errors:users.invalidRole"));
    }

    payload.role = role;
  }

  return payload;
};

const isValidAnalytics = (result) => (
  isRecord(result) &&
  [7, 30, 90].includes(result.range_days) &&
  isRecord(result.summary) &&
  isCount(result.summary.transfers) &&
  isCount(result.summary.pending_inquiries) &&
  typeof result.summary.confirmed_rate === "number" &&
  result.summary.confirmed_rate >= 0 &&
  result.summary.confirmed_rate <= 1 &&
  typeof result.summary.delivery_rate === "number" &&
  result.summary.delivery_rate >= 0 &&
  result.summary.delivery_rate <= 1 &&
  Array.isArray(result.trends) &&
  result.trends.every((row) => isRecord(row) && typeof row.day === "string" && TRP_DIRECTIONS.has(row.direction) && isCount(row.count)) &&
  Array.isArray(result.transfer_states) &&
  result.transfer_states.every((row) => isRecord(row) && TRP_INQUIRY_STATES.has(row.state) && isCount(row.count)) &&
  Array.isArray(result.message_states) &&
  result.message_states.every((row) => isRecord(row) && TRP_MESSAGE_PHASES.has(row.phase) && TRP_DELIVERY_STATES.has(row.delivery_state) && isCount(row.count)) &&
  Array.isArray(result.asset_amounts) &&
  result.asset_amounts.every((row) => isRecord(row) && isUuid(row.id) && isNullableString(row.asset_dti) && typeof row.amount === "string")
);

const hasValidTransferFields = (item) => (
  isRecord(item) &&
  isUuid(item.id) &&
  item.protocol === "TRP" &&
  TRP_DIRECTIONS.has(item.direction) &&
  TRP_INQUIRY_STATES.has(item.state) &&
  isNullableString(item.asset_dti) &&
  isNullableString(item.amount) &&
  isNullableString(item.expires_at) &&
  typeof item.retention_until === "string" &&
  typeof item.created_at === "string" &&
  typeof item.updated_at === "string"
);

const hasValidMessageFields = (item) => (
  isRecord(item) &&
  isUuid(item.id) &&
  isUuid(item.transfer_id) &&
  TRP_MESSAGE_PHASES.has(item.phase) &&
  TRP_DIRECTIONS.has(item.direction) &&
  isUuid(item.logical_identifier) &&
  isUuid(item.request_identifier) &&
  TRP_DELIVERY_STATES.has(item.delivery_state) &&
  (item.status_code === null || Number.isSafeInteger(item.status_code)) &&
  isNullableString(item.error_code) &&
  (item.superseded_by === null || isUuid(item.superseded_by)) &&
  typeof item.created_at === "string" &&
  isNullableString(item.delivered_at)
);

const hasValidTokenFields = (item) => (
  isRecord(item) &&
  isUuid(item.id) &&
  isUuid(item.transfer_id) &&
  TRP_MESSAGE_PHASES.has(item.purpose) &&
  typeof item.expires_at === "string" &&
  isNullableString(item.consumed_at) &&
  typeof item.created_at === "string"
);

const hasValidEventFields = (item) => (
  isRecord(item) &&
  isPositiveBigintString(item.id) &&
  isUuid(item.transfer_id) &&
  TRP_EVENT_TYPES.has(item.event_type) &&
  (item.from_state === null || TRP_INQUIRY_STATES.has(item.from_state)) &&
  (item.to_state === null || TRP_INQUIRY_STATES.has(item.to_state)) &&
  (item.actor_user_id === null || isPositiveBigintString(item.actor_user_id)) &&
  (item.actor_role === null || MANAGED_USER_ROLES.has(item.actor_role)) &&
  typeof item.created_at === "string"
);

const isValidTransferResource = (item) => hasExactKeys(item, TRANSFER_FIELDS) && hasValidTransferFields(item);
const isValidMessageResource = (item) => hasExactKeys(item, MESSAGE_FIELDS) && hasValidMessageFields(item);
const isValidTokenResource = (item) => hasExactKeys(item, TOKEN_FIELDS) && hasValidTokenFields(item);
const isValidEventResource = (item) => hasExactKeys(item, EVENT_FIELDS) && hasValidEventFields(item);
const isValidRetryActions = (actions) => hasExactKeys(actions, ["can_retry"]) && typeof actions.can_retry === "boolean";
const isValidTransferActions = (actions) => (
  hasExactKeys(actions, ["can_cancel", "can_confirm", "can_email", "can_retry"]) &&
  typeof actions.can_cancel === "boolean" &&
  typeof actions.can_confirm === "boolean" &&
  typeof actions.can_email === "boolean" &&
  typeof actions.can_retry === "boolean"
);
const isValidTransferDetail = (item) => (
  hasExactKeys(item, [...TRANSFER_FIELDS, "actions", "email_enabled", "email_fallback_available_at", "events"]) &&
  hasValidTransferFields(item) &&
  isValidTransferActions(item.actions) &&
  typeof item.email_enabled === "boolean" &&
  isNullableString(item.email_fallback_available_at) &&
  Array.isArray(item.events) &&
  item.events.every(isValidEventResource)
);
const isValidMessageDetail = (item) => hasExactKeys(item, [...MESSAGE_FIELDS, "actions"]) && hasValidMessageFields(item) && isValidRetryActions(item.actions);

const managementListValidators = {
  events: isValidEventResource, messages: isValidMessageResource, tokens: isValidTokenResource, transfers: isValidTransferResource,
};
const managementDetailValidators = {
  events: isValidEventResource, messages: isValidMessageDetail, tokens: isValidTokenResource, transfers: isValidTransferDetail,
};

const managementValidator = (resource, detail = false) => {
  if (!TRP_MANAGEMENT_RESOURCES.has(resource)) {
    throw new Error(i18n.t("errors:trp.invalidManagementResource"));
  }

  return (detail ? managementDetailValidators : managementListValidators)[resource];
};

const isValidManagementList = (result, validator) => (
  isRecord(result) &&
  Array.isArray(result.data) &&
  result.data.every(validator) &&
  isCount(result.total) &&
  Number.isSafeInteger(result.page) &&
  result.page > 0 &&
  Number.isSafeInteger(result.limit) &&
  result.limit > 0
);

const isValidTransferOutcome = (result) => (
  isRecord(result) &&
  isUuid(result.id) &&
  TRP_INQUIRY_STATES.has(result.state) &&
  typeof result.retryable === "boolean"
);

const isValidRetryOutcome = (result) => isRecord(result) && isUuid(result.id) && typeof result.retryable === "boolean";
const isValidTravelAddress = (result) => isRecord(result) && isUuid(result.id) && typeof result.travel_address === "string" && typeof result.expires_at === "string";
const isValidKeyMetadata = (result) => isRecord(result) && typeof result.configured === "boolean" && isNullableString(result.masked) && isNullableString(result.updated_at);
const isValidRevealedKey = (result) => isRecord(result) && typeof result.api_key === "string" && isNullableString(result.updated_at);
const hasValidApiClientScopes = (scopes) => (
  Array.isArray(scopes)
  && scopes.length > 0
  && new Set(scopes).size === scopes.length
  && scopes.every((scope) => API_CLIENT_SCOPES.has(scope))
);
const isValidApiClientCredential = (credential) => (
  hasExactKeys(credential, ["created_at", "expires_at", "id", "revoked_at"])
  && isUuid(credential.id)
  && isIsoTimestamp(credential.created_at)
  && isNullableIsoTimestamp(credential.expires_at)
  && isNullableIsoTimestamp(credential.revoked_at)
);
const isValidApiClient = (client) => (
  hasExactKeys(client, ["created_at", "credentials", "id", "name", "scopes", "status"])
  && isUuid(client.id)
  && typeof client.name === "string"
  && client.name.length > 0
  && hasValidApiClientScopes(client.scopes)
  && API_CLIENT_STATUSES.has(client.status)
  && isIsoTimestamp(client.created_at)
  && Array.isArray(client.credentials)
  && client.credentials.every(isValidApiClientCredential)
);
const isValidApiClientList = (result) => (
  hasExactKeys(result, ["data"])
  && Array.isArray(result.data)
  && result.data.every(isValidApiClient)
);
const isValidCreatedApiClient = (result) => (
  hasExactKeys(result, ["api_key", "createdAt", "id", "name", "scopes", "status"])
  && typeof result.api_key === "string"
  && result.api_key.length > 0
  && isIsoTimestamp(result.createdAt)
  && isUuid(result.id)
  && typeof result.name === "string"
  && result.name.length > 0
  && hasValidApiClientScopes(result.scopes)
  && API_CLIENT_STATUSES.has(result.status)
);
const isValidRotatedApiClientCredential = (result) => (
  hasExactKeys(result, ["api_key", "credentialId", "expiresAt"])
  && typeof result.api_key === "string"
  && result.api_key.length > 0
  && isUuid(result.credentialId)
  && isNullableIsoTimestamp(result.expiresAt)
);
const isValidRuntimeConfiguration = (result) => {
  if (
    !hasExactKeys(result, ["encryption", "identity", "integrations", "mode", "operations"])
    || !["auth", "trp"].includes(result.mode)
    || !hasExactKeys(result.integrations, ["email_mode", "oidc_enabled"])
    || !EMAIL_MODES.has(result.integrations.email_mode)
    || typeof result.integrations.oidc_enabled !== "boolean"
  ) {
    return false;
  }

  if (result.mode === "auth") {
    return result.encryption === null && result.identity === null && result.operations === null;
  }

  return (
    hasExactKeys(result.identity, ["lei", "name", "public_base_url"])
    && typeof result.identity.lei === "string"
    && typeof result.identity.name === "string"
    && typeof result.identity.public_base_url === "string"
    && hasExactKeys(result.operations, ["email_fallback_delay_minutes", "http_timeout_ms", "retention_days", "token_ttl_seconds"])
    && Object.values(result.operations).every((value) => Number.isSafeInteger(value) && value > 0)
    && hasExactKeys(result.encryption, ["active_key_id", "retired_key_count"])
    && typeof result.encryption.active_key_id === "string"
    && result.encryption.active_key_id.length > 0
    && isCount(result.encryption.retired_key_count)
  );
};
const isValidEmailJob = (result) => (
  hasExactKeys(result, EMAIL_JOB_FIELDS) &&
  isUuid(result.id) &&
  isUuid(result.transfer_id) &&
  typeof result.recipient_email === "string" &&
  result.recipient_email.trim() !== "" &&
  TRP_EMAIL_STATES.has(result.status) &&
  isCount(result.attempts) &&
  isNullableString(result.last_error_code) &&
  typeof result.created_at === "string" &&
  typeof result.updated_at === "string" &&
  typeof result.expires_at === "string" &&
  isNullableString(result.sent_at) &&
  isNullableString(result.consumed_at)
);
const isValidEmailJobList = (result) => isValidManagementList(result, isValidEmailJob);
const isValidEmailAddress = (address) => (
  hasExactKeys(address, ["country", "lines", "town"]) &&
  isNullableString(address.country) &&
  Array.isArray(address.lines) &&
  address.lines.every((line) => typeof line === "string") &&
  isNullableString(address.town)
);
const isValidEmailParty = (party) => (
  hasExactKeys(party, ["accounts", "addresses", "country", "name", "type"]) &&
  Array.isArray(party.accounts) &&
  party.accounts.every((account) => typeof account === "string") &&
  Array.isArray(party.addresses) &&
  party.addresses.every(isValidEmailAddress) &&
  isNullableString(party.country) &&
  typeof party.name === "string" &&
  ["legal", "natural"].includes(party.type)
);
const isValidEmailAccessSummary = (result) => (
  hasExactKeys(result, ["beneficiaries", "originators", "transfer"]) &&
  Array.isArray(result.beneficiaries) &&
  result.beneficiaries.every(isValidEmailParty) &&
  Array.isArray(result.originators) &&
  result.originators.every(isValidEmailParty) &&
  hasExactKeys(result.transfer, ["amount", "asset", "created_at", "direction", "expires_at", "id", "protocol", "state"]) &&
  isNullableString(result.transfer.amount) &&
  (result.transfer.asset === null || hasExactKeys(result.transfer.asset, ["dti"]) && typeof result.transfer.asset.dti === "string") &&
  typeof result.transfer.created_at === "string" &&
  result.transfer.direction === "outbound" &&
  isNullableString(result.transfer.expires_at) &&
  isUuid(result.transfer.id) &&
  result.transfer.protocol === "TRP" &&
  ["approved", "pending", "rejected"].includes(result.transfer.state)
);

export const loginUser = (email, password) => request(
  async () => {
    const response = await api.post("/auth/login", { email, password }, {
      headers: { "Content-Type": "application/json" },
    });
    const token = response.data.data;

    if (typeof token !== "string" || !token) {
      throw new Error(i18n.t("errors:auth.noToken"));
    }

    return true;
  },
  "errors:api.loginFailed",
);

export const getUserInfo = () => request(
  async () => {
    const response = await api.get("/auth/me", {});
    const user = response.data.data;

    if (!isValidUser(user)) {
      throw new Error(i18n.t("errors:auth.invalidUser"));
    }

    return user;
  },
  "errors:api.fetchUser",
);

export const logoutUser = () => request(
  async () => {
    await api.post("/auth/logout");
  },
  "errors:api.fetchUser",
);

export const forgotPassword = (email) => request(
  async () => {
    const response = await api.post("/auth/forgot", { email });
    return response.data;
  },
  "errors:api.sendResetLink",
);

export const resetPassword = (token, password) => request(
  async () => {
    const response = await api.post("/auth/password", { token, password });
    return response.data;
  },
  "errors:api.resetPassword",
);

export const changePassword = (oldPassword, newPassword) => request(
  async () => {
    const formData = new URLSearchParams();
    formData.append("old_password", oldPassword);
    formData.append("new_password", newPassword);
    const response = await api.post("/auth/reset", formData, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return response.data;
  },
  "errors:api.changePassword",
);

export const listManagedUsers = ({ page = 1, limit = 10, search = "" } = {}) => request(
  async () => {
    const searchParams = new URLSearchParams();
    searchParams.set("page", String(page));
    searchParams.set("limit", String(limit));

    if (typeof search === "string" && search.trim() !== "") {
      searchParams.set("search", search.trim());
    }

    const response = await api.get(`/auth/manage/list?${searchParams.toString()}`);

    if (!isValidManagedUserListResponse(response.data)) {
      throw new Error(i18n.t("errors:users.invalidListResponse"));
    }

    return { data: response.data.data, pageCount: response.data.page_count };
  },
  "errors:api.fetchManagedUsers",
);

export const createManagedUser = ({ email, role } = {}) => request(
  async () => {
    const response = await api.post("/auth/manage/create", managedUserPayload({ email, role }));

    if (!isValidManagedUserMutationResponse(response.data)) {
      throw new Error(i18n.t("errors:users.invalidMutationResponse"));
    }

    return response.data;
  },
  "errors:api.createManagedUser",
);

export const editManagedUser = ({ email, role } = {}) => request(
  async () => {
    const response = await api.post("/auth/manage/edit", managedUserPayload({ email, role }));

    if (!isValidManagedUserMutationResponse(response.data)) {
      throw new Error(i18n.t("errors:users.invalidMutationResponse"));
    }

    return response.data;
  },
  "errors:api.editManagedUser",
);

export const activateManagedUser = (email) => request(
  async () => {
    const response = await api.post("/auth/manage/activate", { email });

    if (!isValidManagedUserMutationResponse(response.data)) {
      throw new Error(i18n.t("errors:users.invalidMutationResponse"));
    }

    return response.data;
  },
  "errors:api.activateManagedUser",
);

export const deactivateManagedUser = (email) => request(
  async () => {
    const response = await api.post("/auth/manage/deactivate", { email });

    if (!isValidManagedUserMutationResponse(response.data)) {
      throw new Error(i18n.t("errors:users.invalidMutationResponse"));
    }

    return response.data;
  },
  "errors:api.deactivateManagedUser",
);

export const listTrpInquiries = ({ status = null, search = "", page = 1, limit = 10 } = {}) => request(
  async () => {
    const searchParams = new URLSearchParams();

    if (status) {
      searchParams.set("status", status);
    }

    if (typeof search === "string" && search.trim()) {
      searchParams.set("search", search.trim());
    }

    searchParams.set("page", String(page));
    searchParams.set("limit", String(limit));
    const response = await api.get(`/travel-rule/trp/inquiries?${searchParams.toString()}`);

    if (!isValidInquiryList(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidListResponse"));
    }

    return response.data;
  },
  "errors:api.fetchTrpInquiries",
);

export const getTrpInquiry = (id) => request(
  async () => {
    const response = await api.get(`/travel-rule/trp/inquiries/${encodeURIComponent(id)}`);

    if (!isValidInquiryDetail(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidDetailResponse"));
    }

    return response.data;
  },
  "errors:api.fetchTrpInquiry",
);

export const decideTrpInquiry = (id, payload) => request(
  async () => {
    const response = await api.post(`/travel-rule/trp/inquiries/${encodeURIComponent(id)}/decision`, payload);

    if (!isValidInquiryDecision(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidDecisionResponse"));
    }

    return response.data;
  },
  "errors:api.decideTrpInquiry",
);

export const getTrpAnalytics = (range = "30d") => request(
  async () => {
    const response = await api.get(`/travel-rule/trp/management/analytics?range=${encodeURIComponent(range)}`);

    if (!isValidAnalytics(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidAnalyticsResponse"));
    }

    return response.data;
  },
  "errors:api.fetchTrpAnalytics",
);

export const listTrpManagementResources = (resource, { page = 1, limit = 20, search = "", ...filters } = {}) => request(
  async () => {
    const validator = managementValidator(resource);
    const searchParams = new URLSearchParams({ page: String(page), limit: String(limit) });

    if (typeof search === "string" && search.trim()) searchParams.set("search", search.trim());
    Object.entries(TRP_MANAGEMENT_FILTERS[resource]).forEach(([key, values]) => {
      if (values.has(filters[key])) searchParams.set(key, filters[key]);
    });
    const response = await api.get(`/travel-rule/trp/management/${resource}?${searchParams.toString()}`);

    if (!isValidManagementList(response.data, validator)) {
      throw new Error(i18n.t("errors:trp.invalidManagementListResponse"));
    }

    return response.data;
  },
  "errors:api.fetchTrpManagementResources",
);

export const getTrpManagementResource = (resource, id) => request(
  async () => {
    const validator = managementValidator(resource, true);
    const response = await api.get(`/travel-rule/trp/management/${resource}/${encodeURIComponent(id)}`);

    if (!validator(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidManagementDetailResponse"));
    }

    return response.data;
  },
  "errors:api.fetchTrpManagementResource",
);

export const listTravelRuleEmailJobs = ({ page = 1, limit = 20, status = "all" } = {}) => request(
  async () => {
    const searchParams = new URLSearchParams({ page: String(page), limit: String(limit) });

    if (TRP_EMAIL_STATES.has(status)) {
      searchParams.set("status", status);
    }

    const response = await api.get(`/travel-rule/trp/management/emails?${searchParams.toString()}`);

    if (!isValidEmailJobList(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidEmailJobResponse"));
    }

    return response.data;
  },
  "errors:api.fetchTravelRuleEmails",
);

export const createTravelRuleEmailInvitation = (transferId, recipientEmail) => request(
  async () => {
    const response = await api.post(
      `/travel-rule/trp/management/transfers/${encodeURIComponent(transferId)}/email-invitations`,
      { recipient_email: recipientEmail },
    );

    if (!isValidEmailJob(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidEmailJobResponse"));
    }

    return response.data;
  },
  "errors:api.createTravelRuleEmail",
);

export const retryTravelRuleEmailJob = (id) => request(
  async () => {
    const response = await api.post(`/travel-rule/trp/management/emails/${encodeURIComponent(id)}/retry`);

    if (!isValidEmailJob(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidEmailJobResponse"));
    }

    return response.data;
  },
  "errors:api.retryTravelRuleEmail",
);

export const consumeTravelRuleEmailAccess = (token) => request(
  async () => {
    const response = await api.post("/travel-rule/trp/email-access/consume", { token });

    if (!isValidEmailAccessSummary(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidEmailAccessResponse"));
    }

    return response.data;
  },
  "errors:api.consumeTravelRuleEmail",
);

export const createTrpTravelAddress = (payload) => request(
  async () => {
    const response = await api.post("/travel-rule/trp/management/travel-addresses", payload);

    if (!isValidTravelAddress(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidTravelAddressResponse"));
    }

    return response.data;
  },
  "errors:api.createTrpTravelAddress",
);

export const createTrpTransfer = (payload) => request(
  async () => {
    const response = await api.post("/travel-rule/trp/management/transfers", payload);

    if (!isValidTransferOutcome(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidTransferMutationResponse"));
    }

    return response.data;
  },
  "errors:api.createTrpTransfer",
);

export const confirmTrpTransfer = (id, payload) => request(
  async () => {
    const response = await api.post(`/travel-rule/trp/management/transfers/${encodeURIComponent(id)}/confirm`, payload);

    if (!isValidTransferOutcome(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidTransferMutationResponse"));
    }

    return response.data;
  },
  "errors:api.confirmTrpTransfer",
);

export const retryTrpTransfer = (id) => request(
  async () => {
    const response = await api.post(`/travel-rule/trp/management/transfers/${encodeURIComponent(id)}/retry`);

    if (!isValidRetryOutcome(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidTransferMutationResponse"));
    }

    return response.data;
  },
  "errors:api.retryTrpTransfer",
);

export const getServiceApiKey = () => request(
  async () => {
    const response = await api.get("/auth/manage/configuration/service-api-key");

    if (!isValidKeyMetadata(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidConfigurationResponse"));
    }

    return response.data;
  },
  "errors:api.fetchServiceApiKey",
);

export const revealServiceApiKey = () => request(
  async () => {
    const response = await api.post("/auth/manage/configuration/service-api-key/reveal");

    if (!isValidRevealedKey(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidConfigurationResponse"));
    }

    return response.data;
  },
  "errors:api.revealServiceApiKey",
);

export const rotateServiceApiKey = (apiKey) => request(
  async () => {
    const response = await api.put("/auth/manage/configuration/service-api-key", { api_key: apiKey });

    if (!isValidKeyMetadata(response.data)) {
      throw new Error(i18n.t("errors:trp.invalidConfigurationResponse"));
    }

    return response.data;
  },
  "errors:api.rotateServiceApiKey",
);

export const getRuntimeConfiguration = () => request(
  async () => {
    const response = await api.get("/auth/manage/configuration/runtime");

    if (!isValidRuntimeConfiguration(response.data)) {
      throw new Error(i18n.t("errors:configuration.invalidRuntimeResponse"));
    }

    return response.data;
  },
  "errors:api.fetchRuntimeConfiguration",
);

export const listApiClients = () => request(
  async () => {
    const response = await api.get("/auth/manage/api-clients");

    if (!isValidApiClientList(response.data)) {
      throw new Error(i18n.t("errors:configuration.invalidApiClientListResponse"));
    }

    return response.data.data;
  },
  "errors:api.fetchApiClients",
);

export const createApiClient = ({ expiresAt = null, name, scopes } = {}) => request(
  async () => {
    const response = await api.post("/auth/manage/api-clients", { expires_at: expiresAt, name, scopes });

    if (!isValidCreatedApiClient(response.data)) {
      throw new Error(i18n.t("errors:configuration.invalidApiClientResponse"));
    }

    return response.data;
  },
  "errors:api.createApiClient",
);

export const rotateApiClientCredential = (clientId, { expiresAt = null } = {}) => request(
  async () => {
    const response = await api.post(`/auth/manage/api-clients/${encodeURIComponent(clientId)}/credentials`, { expires_at: expiresAt });

    if (!isValidRotatedApiClientCredential(response.data)) {
      throw new Error(i18n.t("errors:configuration.invalidApiClientCredentialResponse"));
    }

    return response.data;
  },
  "errors:api.rotateApiClientCredential",
);

export const revokeApiClientCredential = (clientId, credentialId) => request(
  async () => {
    const response = await api.delete(`/auth/manage/api-clients/${encodeURIComponent(clientId)}/credentials/${encodeURIComponent(credentialId)}`);

    if (response.status !== 204) {
      throw new Error(i18n.t("errors:configuration.invalidApiClientCredentialResponse"));
    }

    return true;
  },
  "errors:api.revokeApiClientCredential",
);

export const listComplianceCases = ({ state = null, page = 1, limit = 20 } = {}) => request(
  async () => {
    const searchParams = new URLSearchParams({ limit: String(limit), page: String(page) });

    if (state) {
      searchParams.set("state", state);
    }

    const response = await api.get(`/travel-rule/v1/cases?${searchParams.toString()}`);

    if (!isValidComplianceCaseList(response.data)) {
      throw new Error(i18n.t("errors:compliance.invalidCaseList"));
    }

    return response.data;
  },
  "errors:api.fetchComplianceCases",
);

export const getComplianceCase = (id) => request(
  async () => {
    const response = await api.get(`/travel-rule/v1/cases/${encodeURIComponent(id)}`);

    if (!isValidComplianceCase(response.data)) {
      throw new Error(i18n.t("errors:compliance.invalidCase"));
    }

    return response.data;
  },
  "errors:api.fetchComplianceCase",
);

export const decideComplianceCase = (id, payload) => request(
  async () => {
    const response = await api.post(`/travel-rule/v1/cases/${encodeURIComponent(id)}/decisions`, payload);

    if (!isValidCaseDecisionResult(response.data)) {
      throw new Error(i18n.t("errors:compliance.invalidCaseDecision"));
    }

    return response.data;
  },
  "errors:api.decideComplianceCase",
);
