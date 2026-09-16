import axios from "axios";
import * as apiModule from "@/lib/api";

jest.mock("axios", () => {
  const createInterceptor = () => {
    const handlers = [];
    return {
      handlers,
      use: jest.fn((fulfilled, rejected) => handlers.push({ fulfilled, rejected })),
    };
  };
  const createInstance = () => ({
    delete: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    interceptors: {
      request: createInterceptor(),
      response: createInterceptor(),
    },
  });
  const axiosMock = { lastCreateConfig: null };
  axiosMock.create = jest.fn((config) => {
    axiosMock.lastCreateConfig = config;
    return createInstance();
  });
  return { __esModule: true, default: axiosMock };
});

const instances = axios.create.mock.results.map(({ value }) => value);
const configurations = axios.create.mock.calls.map(([config]) => config);
const api = instances[0];
const deleteRequest = jest.spyOn(api, "delete");
const get = jest.spyOn(api, "get");
const post = jest.spyOn(api, "post");
const put = jest.spyOn(api, "put");

beforeEach(() => {
  deleteRequest.mockReset();
  get.mockReset();
  post.mockReset();
  put.mockReset();
});

test("exposes the retained authentication and TRP inquiry-review API helpers", () => {
  expect(Object.keys(apiModule).sort()).toEqual([
    "activateManagedUser",
    "changePassword",
    "confirmTrpTransfer",
    "consumeTravelRuleEmailAccess",
    "createApiClient",
    "createManagedUser",
    "createTravelRuleEmailInvitation",
    "createTrpTransfer",
    "createTrpTravelAddress",
    "deactivateManagedUser",
    "decideComplianceCase",
    "decideTrpInquiry",
    "editManagedUser",
    "forgotPassword",
    "getComplianceCase",
    "getRuntimeConfiguration",
    "getServiceApiKey",
    "getTrpAnalytics",
    "getTrpInquiry",
    "getTrpManagementResource",
    "getUserInfo",
    "listApiClients",
    "listComplianceCases",
    "listManagedUsers",
    "listTravelRuleEmailJobs",
    "listTrpInquiries",
    "listTrpManagementResources",
    "loginUser",
    "logoutUser",
    "resetPassword",
    "retryTravelRuleEmailJob",
    "retryTrpTransfer",
    "revealServiceApiKey",
    "revokeApiClientCredential",
    "rotateApiClientCredential",
    "rotateServiceApiKey",
    "shouldRedirectUnauthorized",
    "submitUpdateRequest",
  ]);
});

test("validates protocol-neutral compliance case list, detail, and decision responses", async () => {
  const caseId = "10000000-0000-4000-8000-000000000001";
  const transferId = "20000000-0000-4000-8000-000000000001";
  const exchangeId = "30000000-0000-4000-8000-000000000001";
  const item = {
    created_at: "2026-08-27T09:00:00.000Z",
    exchange: { connector: "native_trp", id: exchangeId, state: "completed" },
    external_id: "withdrawal-42",
    id: caseId,
    required_approval: "compliance_reviewer",
    state: "pending",
    transfer_id: transferId,
    transfer_state: "on_hold",
    updated_at: "2026-08-27T10:00:00.000Z",
    version: 0,
  };

  get.mockResolvedValueOnce({ data: { data: [item], limit: 20, page: 1, total: 1 } });
  await expect(apiModule.listComplianceCases({ state: "pending" })).resolves.toMatchObject({ total: 1 });
  expect(get).toHaveBeenLastCalledWith("/travel-rule/v1/cases?limit=20&page=1&state=pending");

  get.mockResolvedValueOnce({ data: { ...item, exchange: { id: exchangeId, state: "completed" } } });
  await expect(apiModule.getComplianceCase(caseId)).resolves.toMatchObject({ id: caseId });

  post.mockResolvedValueOnce({ data: { case_state: "approved", transfer_state: "ready", version: 1 } });
  await expect(apiModule.decideComplianceCase(caseId, { decision: "approved", expected_version: 0, reason: "verified" })).resolves.toMatchObject({ version: 1 });
});

test("uses relative same-origin API requests with the bounded timeout", () => {
  expect(configurations[0]).toEqual({
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
    withCredentials: true,
  });
});

test("sends updates through an isolated public client without application credentials", async () => {
  expect(apiModule.submitUpdateRequest).toEqual(expect.any(Function));
  const updates = instances[1];
  expect(configurations[1]).toEqual({
    baseURL: "https://api.getdefy.co", headers: { "Content-Type": "application/json" }, timeout: 30000, withCredentials: false,
  });
  expect(updates.interceptors.request.handlers).toHaveLength(0);
  expect(updates.interceptors.response.handlers).toHaveLength(0);
  updates.post.mockResolvedValueOnce({ status: 200, data: { code: 0, message: "OK", data: null } });
  await expect(apiModule.submitUpdateRequest(" reader@example.test ")).resolves.toBe(true);
  expect(updates.post).toHaveBeenLastCalledWith("/contact/create", {
    email: "reader@example.test", subject: "Travel Rule Playground updates",
    message: "I would like to receive updates about Travel Rule Playground at this email address.",
  });
  expect(post).not.toHaveBeenCalled();
});

test.each([
  [{ response: { status: 400, data: { message: "private details" } } }, "Check your email address and try again."],
  [{ response: { status: 429 } }, "Too many requests. Please try again in 15 minutes."],
  [{ response: { status: 500 } }, "We could not send your request. Please try again later."],
  [{ response: { status: 401 } }, "We could not send your request. Please try again later."],
  [{ code: "ECONNABORTED" }, "The request timed out. Please try again."],
  [{ code: "ETIMEDOUT" }, "The request timed out. Please try again."],
  [{ message: "Network Error" }, "Could not connect. Check your connection and try again."],
])("localizes a contact failure without redirecting or retrying %#", async (error, message) => {
  expect(apiModule.submitUpdateRequest).toEqual(expect.any(Function));
  const updates = instances[1];
  updates.post.mockReset().mockRejectedValueOnce(error);
  localStorage.setItem("authToken", "unrelated-session");
  await expect(apiModule.submitUpdateRequest("reader@example.test")).rejects.toThrow(message);
  expect(updates.post).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("authToken")).toBe("unrelated-session");
  localStorage.removeItem("authToken");
});

test.each([
  { status: 202, data: { code: 0, message: "OK", data: null } },
  { status: 200, data: { code: 1, message: "OK", data: null } },
  { status: 200, data: null },
])("rejects an unexpected contact acknowledgement %#", async (response) => {
  expect(apiModule.submitUpdateRequest).toEqual(expect.any(Function));
  instances[1].post.mockResolvedValueOnce(response);
  await expect(apiModule.submitUpdateRequest("reader@example.test")).rejects.toThrow("We could not send your request. Please try again later.");
});

test.each([
  ["messages", { direction: "inbound", phase: "inquiry", delivery_state: "received", state: "approved" }, "direction=inbound&phase=inquiry&delivery_state=received"],
  ["tokens", { purpose: "resolution", status: "active", direction: "inbound" }, "purpose=resolution&status=active"],
  ["events", { event_type: "manual_approval", from_state: "pending", to_state: "approved" }, "event_type=manual_approval&from_state=pending&to_state=approved"],
])("serializes only supported %s filters", async (resource, options, expectedQuery) => {
  get.mockResolvedValue({ data: { data: [], page: 1, limit: 20, total: 0 } });
  await apiModule.listTrpManagementResources(resource, { ...options, search: " %_needle " });
  expect(get).toHaveBeenLastCalledWith(`/travel-rule/trp/management/${resource}?page=1&limit=20&search=%25_needle&${expectedQuery}`);
});

test("serializes trimmed inquiry search with the existing status and pagination", async () => {
  get.mockResolvedValue({ data: { data: [], page: 2, limit: 25, total: 0 } });
  await apiModule.listTrpInquiries({ status: "pending", search: " asset%_ ", page: 2, limit: 25 });
  expect(get).toHaveBeenLastCalledWith("/travel-rule/trp/inquiries?status=pending&search=asset%25_&page=2&limit=25");
});

test("uses the CSRF cookie for unsafe requests and never injects a stored bearer token", () => {
  const requestHandler = api.interceptors.request.handlers[0];
  localStorage.setItem("authToken", "stored-token");
  document.cookie = `defy_csrf=${"c".repeat(43)}`;

  const postRequest = requestHandler.fulfilled({ headers: {}, method: "post" });
  const getRequest = requestHandler.fulfilled({ headers: {}, method: "get" });

  expect(postRequest.headers["X-CSRF-Token"]).toBe("c".repeat(43));
  expect(postRequest.headers.Authorization).toBeUndefined();
  expect(getRequest.headers["X-CSRF-Token"]).toBeUndefined();
  expect(getRequest.headers.Authorization).toBeUndefined();
});

test("does not add a CSRF header when no browser cookie is available", () => {
  const requestHandler = api.interceptors.request.handlers[0];
  document.cookie = "defy_csrf=; Max-Age=0; path=/";

  const request = requestHandler.fulfilled({ headers: {}, method: "post" });
  expect(request.headers["X-CSRF-Token"]).toBeUndefined();
});

test.each([
  ["list", () => apiModule.listComplianceCases(), get],
  ["detail", () => apiModule.getComplianceCase("case/id"), get],
  ["decision", () => apiModule.decideComplianceCase("case/id", { decision: "approved" }), post],
])("rejects a malformed compliance case %s response", async (_name, invoke, method) => {
  method.mockResolvedValueOnce({ data: { unexpected: true } });
  await expect(invoke()).rejects.toThrow(/Invalid compliance/i);
});

test("propagates interceptor results and uses fallback messages for unstructured failures", async () => {
  const requestHandler = api.interceptors.request.handlers[0];
  const responseHandler = api.interceptors.response.handlers[0];
  const requestError = new Error("request failed");
  const response = { data: { ok: true } };

  await expect(requestHandler.rejected(requestError)).rejects.toBe(requestError);
  expect(responseHandler.fulfilled(response)).toBe(response);
  await expect(responseHandler.rejected({ response: { status: 500 } })).rejects.toEqual({ response: { status: 500 } });

  post.mockRejectedValueOnce({});
  await expect(apiModule.loginUser("a@b.co", "secret")).rejects.toThrow("Login failed");
});

test("preserves the upstream HTTP status on normalized errors", async () => {
  get.mockRejectedValueOnce({ response: { status: 409, data: { message: "Inquiry conflict" } } });

  await expect(apiModule.getTrpInquiry("inquiry-id")).rejects.toMatchObject({
    message: "Inquiry conflict",
    status: 409,
  });
});

test.each(["/login", "/travel-rule/shared"])("clears only authentication storage without redirecting from public route %s", async (pathname) => {
  const originalUrl = window.location.href;
  window.history.pushState({}, "", pathname);
  const error = { response: { status: 401 } };
  localStorage.setItem("authToken", "token");
  localStorage.setItem("userData", "legacy-data");

  await expect(api.interceptors.response.handlers[0].rejected(error)).rejects.toBe(error);

  expect(window.location.pathname).toBe(pathname);
  expect(localStorage.getItem("authToken")).toBeNull();
  expect(localStorage.getItem("userData")).toBe("legacy-data");
  window.history.replaceState({}, "", originalUrl);
});

test.each(["/login", "/travel-rule/shared"])("does not redirect a 401 response away from exact public route %s", (pathname) => {
  expect(apiModule.shouldRedirectUnauthorized?.(pathname)).toBe(false);
});

test.each(["/travel-rule/transfers", "/travel-rule/shared/extra"])("redirects a 401 response from non-public route %s", (pathname) => {
  expect(apiModule.shouldRedirectUnauthorized?.(pathname)).toBe(true);
});

test("establishes a cookie-backed login session without returning the bearer token to AuthContext", async () => {
  post.mockResolvedValueOnce({ data: { code: 0, message: "OK", data: "issued-jwt" } });
  await expect(apiModule.loginUser("a@b.co", "secret")).resolves.toBe(true);
  expect(post).toHaveBeenLastCalledWith("/auth/login", { email: "a@b.co", password: "secret" }, { headers: { "Content-Type": "application/json" } });
});

test("rejects a malformed login response before AuthContext restores the cookie session", async () => {
  post.mockResolvedValueOnce({ data: { code: 1, message: "not-ok", data: null } });
  await expect(apiModule.loginUser("a@b.co", "secret")).rejects.toThrow("No token received from login response");
});

test.each(["admin", "user", "platform_admin", "integration_operator", "compliance_reviewer", "compliance_approver", "auditor"])("accepts the supported %s role from /auth/me", async (role) => {
  const user = { email: `${role}@getdefy.co`, role, created_at: "2026-01-01T00:00:00.000Z" };
  get.mockResolvedValueOnce({ data: { data: user } });

  await expect(apiModule.getUserInfo()).resolves.toEqual(user);
  expect(get).toHaveBeenLastCalledWith("/auth/me", {});
});

test.each([
  ["null", null],
  ["an array", []],
  ["a missing email", { role: "user", created_at: "2026-01-01T00:00:00.000Z" }],
  ["a non-string email", { email: 1, role: "user", created_at: "2026-01-01T00:00:00.000Z" }],
  ["a whitespace-only email", { email: "   ", role: "user", created_at: "2026-01-01T00:00:00.000Z" }],
  ["a missing role", { email: "user@getdefy.co", created_at: "2026-01-01T00:00:00.000Z" }],
  ["a non-string role", { email: "user@getdefy.co", role: 1, created_at: "2026-01-01T00:00:00.000Z" }],
  ["a whitespace-only role", { email: "user@getdefy.co", role: "   ", created_at: "2026-01-01T00:00:00.000Z" }],
  ["the retired super_admin role", { email: "user@getdefy.co", role: "super_admin", created_at: "2026-01-01T00:00:00.000Z" }],
  ["a case-variant admin role", { email: "user@getdefy.co", role: "Admin", created_at: "2026-01-01T00:00:00.000Z" }],
  ["an unknown viewer role", { email: "user@getdefy.co", role: "viewer", created_at: "2026-01-01T00:00:00.000Z" }],
  ["a missing creation date", { email: "user@getdefy.co", role: "user" }],
  ["a non-string creation date", { email: "user@getdefy.co", role: "user", created_at: 1 }],
  ["a whitespace-only creation date", { email: "user@getdefy.co", role: "user", created_at: "   " }],
])("rejects %s from /auth/me before it reaches authentication state", async (_name, user) => {
  get.mockResolvedValueOnce({ data: { code: 0, message: "OK", data: user } });
  await expect(apiModule.getUserInfo()).rejects.toThrow("Invalid user information");
});

test("clears the cookie-backed session through the CSRF-protected logout endpoint", async () => {
  post.mockResolvedValueOnce({ data: { code: 0, data: null, message: "OK" } });

  await expect(apiModule.logoutUser()).resolves.toBeUndefined();

  expect(post).toHaveBeenLastCalledWith("/auth/logout");
});

test("uses the retained password endpoint contracts", async () => {
  post.mockResolvedValueOnce({ data: { sent: true } });
  await expect(apiModule.forgotPassword("a@b.co")).resolves.toEqual({ sent: true });
  expect(post).toHaveBeenLastCalledWith("/auth/forgot", { email: "a@b.co" });

  post.mockResolvedValueOnce({ data: { reset: true } });
  await expect(apiModule.resetPassword("token", "new-password")).resolves.toEqual({ reset: true });
  expect(post).toHaveBeenLastCalledWith("/auth/password", { token: "token", password: "new-password" });

  post.mockResolvedValueOnce({ data: { changed: true } });
  await expect(apiModule.changePassword("old", "new")).resolves.toEqual({ changed: true });
  const [, passwordBody, passwordConfig] = post.mock.calls.at(-1);
  expect(passwordBody.toString()).toBe("old_password=old&new_password=new");
  expect(passwordConfig).toEqual({ headers: { "Content-Type": "application/x-www-form-urlencoded" } });
});

test("lists TRP inquiries with pagination and an optional status", async () => {
  const response = {
    data: [{
      id: "57b2251e-eeb0-4de9-8f25-7e87e1cf970b",
      state: "pending",
      asset_dti: null,
      amount: null,
      expires_at: "2026-08-26T12:00:00.000Z",
      created_at: "2026-08-25T12:00:00.000Z",
      updated_at: "2026-08-25T12:00:00.000Z",
    }],
    total: 1,
    page: 2,
    limit: 25,
  };
  get.mockResolvedValueOnce({ data: response });

  await expect(apiModule.listTrpInquiries({ status: "pending", page: 2, limit: 25 })).resolves.toEqual(response);
  expect(get).toHaveBeenLastCalledWith("/travel-rule/trp/inquiries?status=pending&page=2&limit=25");
});

test("omits the status query when listing all TRP inquiries", async () => {
  const response = { data: [], total: 0, page: 1, limit: 10 };
  get.mockResolvedValueOnce({ data: response });

  await expect(apiModule.listTrpInquiries()).resolves.toEqual(response);
  expect(get).toHaveBeenLastCalledWith("/travel-rule/trp/inquiries?page=1&limit=10");
});

test.each([
  [{ data: [], total: "1", page: 1, limit: 10 }],
  [{ data: [{ id: "invalid" }], total: 1, page: 1, limit: 10 }],
  [{ data: [], total: 0, page: 0, limit: 10 }],
])("rejects malformed TRP inquiry list responses", async (response) => {
  get.mockResolvedValueOnce({ data: response });

  await expect(apiModule.listTrpInquiries()).rejects.toThrow("Invalid inquiry list response");
});

test("loads a canonical TRP inquiry detail including nullable IVMS data", async () => {
  const detail = {
    id: "57b2251e-eeb0-4de9-8f25-7e87e1cf970b",
    protocol: "TRP",
    direction: "inbound",
    state: "pending",
    asset: null,
    amount: null,
    expires_at: "2026-08-26T12:00:00.000Z",
    created_at: "2026-08-25T12:00:00.000Z",
    updated_at: "2026-08-25T12:00:00.000Z",
    ivms101: null,
  };
  get.mockResolvedValueOnce({ data: detail });

  await expect(apiModule.getTrpInquiry(detail.id)).resolves.toEqual(detail);
  expect(get).toHaveBeenLastCalledWith(`/travel-rule/trp/inquiries/${detail.id}`);
});

test("rejects malformed TRP inquiry detail responses", async () => {
  get.mockResolvedValueOnce({ data: { id: "57b2251e-eeb0-4de9-8f25-7e87e1cf970b", state: "unknown" } });

  await expect(apiModule.getTrpInquiry("57b2251e-eeb0-4de9-8f25-7e87e1cf970b")).rejects.toThrow("Invalid inquiry detail response");
});

test.each([
  [{ decision: "approved", payment_address: "bc1qexample" }, "approved", false],
  [{ decision: "rejected", reason: "Manual review" }, "rejected", true],
])("submits an exact TRP inquiry decision payload", async (payload, state, retryable) => {
  const id = "57b2251e-eeb0-4de9-8f25-7e87e1cf970b";
  const response = { id, state, retryable };
  post.mockResolvedValueOnce({ data: response });

  await expect(apiModule.decideTrpInquiry(id, payload)).resolves.toEqual(response);
  expect(post).toHaveBeenLastCalledWith(`/travel-rule/trp/inquiries/${id}/decision`, payload);
});

test("rejects malformed TRP inquiry decision responses", async () => {
  post.mockResolvedValueOnce({ data: { id: "id", state: "approved", retryable: "false" } });

  await expect(apiModule.decideTrpInquiry("id", { decision: "approved", payment_address: "address" })).rejects.toThrow("Invalid inquiry decision response");
});

test("loads validated Travel Rule analytics for the selected range", async () => {
  const response = {
    asset_amounts: [{ id: "11111111-1111-4111-8111-111111111111", asset_dti: "dti:eth", amount: "25" }],
    message_states: [{ phase: "inquiry", delivery_state: "delivered", count: 2 }],
    range_days: 30,
    summary: { transfers: 4, pending_inquiries: 1, confirmed_rate: 0.5, delivery_rate: 0.75 },
    transfer_states: [{ state: "confirmed", count: 2 }],
    trends: [{ day: "2026-08-25", direction: "inbound", count: 3 }],
  };
  get.mockResolvedValueOnce({ data: response });

  await expect(apiModule.getTrpAnalytics("30d")).resolves.toEqual(response);
  expect(get).toHaveBeenLastCalledWith("/travel-rule/trp/management/analytics?range=30d");
});

test("accepts received inbound messages in Travel Rule analytics", async () => {
  const response = {
    asset_amounts: [],
    message_states: [{ phase: "inquiry", delivery_state: "received", count: 2 }],
    range_days: 7,
    summary: { transfers: 2, pending_inquiries: 2, confirmed_rate: 0, delivery_rate: 0 },
    transfer_states: [{ state: "pending", count: 2 }],
    trends: [{ day: "2026-08-25", direction: "inbound", count: 2 }],
  };
  get.mockResolvedValueOnce({ data: response });

  await expect(apiModule.getTrpAnalytics("7d")).resolves.toEqual(response);
});

test.each([
  { range_days: 8, summary: {}, trends: [], transfer_states: [], message_states: [], asset_amounts: [] },
  { range_days: 7, summary: { transfers: "1", pending_inquiries: 0, confirmed_rate: 0, delivery_rate: 0 }, trends: [], transfer_states: [], message_states: [], asset_amounts: [] },
  { range_days: 7, summary: { transfers: 1, confirmed_rate: 0, delivery_rate: 0 }, trends: [], transfer_states: [], message_states: [], asset_amounts: [] },
  { range_days: 7, summary: { transfers: 1, pending_inquiries: 0, confirmed_rate: 0, delivery_rate: 0 }, trends: [{ day: "today", direction: "sideways", count: 1 }], transfer_states: [], message_states: [], asset_amounts: [] },
])("rejects malformed Travel Rule analytics", async (response) => {
  get.mockResolvedValueOnce({ data: response });
  await expect(apiModule.getTrpAnalytics("7d")).rejects.toThrow("Invalid analytics response");
});

const managementItems = {
  transfers: { id: "11111111-1111-4111-8111-111111111111", protocol: "TRP", direction: "outbound", state: "pending", asset_dti: "dti:eth", amount: "25", expires_at: null, retention_until: "2026-09-01T00:00:00.000Z", created_at: "2026-08-25T00:00:00.000Z", updated_at: "2026-08-25T00:00:00.000Z" },
  messages: { id: "22222222-2222-4222-8222-222222222222", transfer_id: "11111111-1111-4111-8111-111111111111", phase: "inquiry", direction: "outbound", logical_identifier: "33333333-3333-4333-8333-333333333333", request_identifier: "44444444-4444-4444-8444-444444444444", delivery_state: "failed", status_code: 503, error_code: "peer_unavailable", superseded_by: null, created_at: "2026-08-25T00:00:00.000Z", delivered_at: null },
  tokens: { id: "55555555-5555-4555-8555-555555555555", transfer_id: "11111111-1111-4111-8111-111111111111", purpose: "resolution", expires_at: "2026-08-26T00:00:00.000Z", consumed_at: null, created_at: "2026-08-25T00:00:00.000Z" },
  events: { id: "9223372036854775807", transfer_id: "11111111-1111-4111-8111-111111111111", event_type: "inquiry_received", from_state: null, to_state: "pending", actor_user_id: "9007199254740992", actor_role: "admin", created_at: "2026-08-25T00:00:00.000Z" },
};
const managementDetails = {
  transfers: { ...managementItems.transfers, actions: { can_cancel: false, can_confirm: false, can_email: true, can_retry: true }, email_enabled: true, email_fallback_available_at: "2026-08-25T00:30:00.000Z", events: [managementItems.events] },
  messages: { ...managementItems.messages, actions: { can_retry: true } },
  tokens: managementItems.tokens,
  events: managementItems.events,
};

test("lists and loads safe received inbound message metadata", async () => {
  const receivedMessage = {
    ...managementItems.messages,
    direction: "inbound",
    delivery_state: "received",
    status_code: 200,
    error_code: null,
  };
  const listResponse = { data: [receivedMessage], total: 1, page: 1, limit: 20 };
  const detail = { ...receivedMessage, actions: { can_retry: false } };
  get.mockResolvedValueOnce({ data: listResponse }).mockResolvedValueOnce({ data: detail });

  await expect(apiModule.listTrpManagementResources("messages")).resolves.toEqual(listResponse);
  await expect(apiModule.getTrpManagementResource("messages", receivedMessage.id)).resolves.toEqual(detail);
});

test.each(Object.keys(managementItems))("lists and loads safe %s metadata", async (resource) => {
  const item = managementItems[resource];
  const detail = managementDetails[resource];
  const listResponse = { data: [item], total: 1, page: 2, limit: 25 };
  get.mockResolvedValueOnce({ data: listResponse }).mockResolvedValueOnce({ data: detail });

  await expect(apiModule.listTrpManagementResources(resource, { page: 2, limit: 25 })).resolves.toEqual(listResponse);
  expect(get).toHaveBeenLastCalledWith(`/travel-rule/trp/management/${resource}?page=2&limit=25`);
  await expect(apiModule.getTrpManagementResource(resource, item.id)).resolves.toEqual(detail);
  expect(get).toHaveBeenLastCalledWith(`/travel-rule/trp/management/${resource}/${item.id}`);
});

test("sends safe transfer filters to the server and preserves filtered totals", async () => {
  const response = { data: [managementItems.transfers], total: 1, page: 1, limit: 20 };
  get.mockResolvedValueOnce({ data: response });

  await expect(apiModule.listTrpManagementResources("transfers", {
    direction: "outbound", limit: 20, page: 1, search: "outside page one", state: "approved",
  })).resolves.toEqual(response);
  expect(get).toHaveBeenLastCalledWith("/travel-rule/trp/management/transfers?page=1&limit=20&search=outside+page+one&direction=outbound&state=approved");
});

test("rejects unsupported or malformed management resources before rendering them", async () => {
  await expect(apiModule.listTrpManagementResources("raw-records")).rejects.toThrow("Invalid management resource");
  expect(get).not.toHaveBeenCalled();

  get.mockResolvedValueOnce({ data: { data: [{ id: "private", digest: "secret" }], total: 1, page: 1, limit: 20 } });
  await expect(apiModule.listTrpManagementResources("tokens")).rejects.toThrow("Invalid management resource response");

  get.mockResolvedValueOnce({ data: { ...managementDetails.transfers, operation_encrypted: "secret" } });
  await expect(apiModule.getTrpManagementResource("transfers", managementItems.transfers.id)).rejects.toThrow("Invalid management resource detail response");

  get.mockResolvedValueOnce({ data: { ...managementItems.events, id: 7 } });
  await expect(apiModule.getTrpManagementResource("events", "7")).rejects.toThrow("Invalid management resource detail response");
});

test("uses only supported Travel Rule domain mutation paths and payloads", async () => {
  const travelAddress = { id: "11111111-1111-4111-8111-111111111111", travel_address: "https://peer.example/address", expires_at: "2026-08-27T00:00:00.000Z" };
  const transfer = { id: "22222222-2222-4222-8222-222222222222", state: "pending", retryable: true };
  post.mockResolvedValueOnce({ data: travelAddress }).mockResolvedValueOnce({ data: transfer }).mockResolvedValueOnce({ data: { ...transfer, state: "canceled" } }).mockResolvedValueOnce({ data: { id: transfer.id, retryable: false } });

  await expect(apiModule.createTrpTravelAddress({ beneficiary_reference: "beneficiary", ttl_seconds: 3600 })).resolves.toEqual(travelAddress);
  expect(post).toHaveBeenLastCalledWith("/travel-rule/trp/management/travel-addresses", { beneficiary_reference: "beneficiary", ttl_seconds: 3600 });

  const payload = { travel_address: travelAddress.travel_address, asset: { dti: "dti:eth" }, amount: "25", ivms101: { Originator: {} } };
  await expect(apiModule.createTrpTransfer(payload)).resolves.toEqual(transfer);
  expect(post).toHaveBeenLastCalledWith("/travel-rule/trp/management/transfers", payload);

  await expect(apiModule.confirmTrpTransfer(transfer.id, { canceled: "operator request" })).resolves.toEqual({ ...transfer, state: "canceled" });
  expect(post).toHaveBeenLastCalledWith(`/travel-rule/trp/management/transfers/${transfer.id}/confirm`, { canceled: "operator request" });

  await expect(apiModule.retryTrpTransfer(transfer.id)).resolves.toEqual({ id: transfer.id, retryable: false });
  expect(post).toHaveBeenLastCalledWith(`/travel-rule/trp/management/transfers/${transfer.id}/retry`);
});

test("uses strict Travel Rule email delivery and public access contracts", async () => {
  const job = {
    attempts: 1,
    consumed_at: null,
    created_at: "2026-09-02T10:00:00.000Z",
    expires_at: "2026-10-02T10:00:00.000Z",
    id: "66666666-6666-4666-8666-666666666666",
    last_error_code: null,
    recipient_email: "recipient@example.test",
    sent_at: "2026-09-02T10:00:01.000Z",
    status: "sent",
    transfer_id: managementItems.transfers.id,
    updated_at: "2026-09-02T10:00:01.000Z",
  };
  const summary = {
    beneficiaries: [{ accounts: ["beneficiary-account"], addresses: [{ country: "DE", lines: ["Line one"], town: "Berlin" }], country: "DE", name: "Ada Lovelace", type: "natural" }],
    originators: [],
    transfer: { amount: "25", asset: { dti: "dti:eth" }, created_at: "2026-08-25T00:00:00.000Z", direction: "outbound", expires_at: null, id: managementItems.transfers.id, protocol: "TRP", state: "pending" },
  };

  get.mockResolvedValueOnce({ data: { data: [job], limit: 25, page: 2, total: 1 } });
  await expect(apiModule.listTravelRuleEmailJobs({ limit: 25, page: 2, status: "sent" })).resolves.toMatchObject({ total: 1 });
  expect(get).toHaveBeenLastCalledWith("/travel-rule/trp/management/emails?page=2&limit=25&status=sent");

  post.mockResolvedValueOnce({ data: { ...job, attempts: 0, sent_at: null, status: "queued" } });
  await expect(apiModule.createTravelRuleEmailInvitation(job.transfer_id, "recipient@example.test")).resolves.toMatchObject({ status: "queued" });
  expect(post).toHaveBeenLastCalledWith(`/travel-rule/trp/management/transfers/${job.transfer_id}/email-invitations`, { recipient_email: "recipient@example.test" });

  post.mockResolvedValueOnce({ data: { ...job, attempts: 0, sent_at: null, status: "queued" } });
  await expect(apiModule.retryTravelRuleEmailJob(job.id)).resolves.toMatchObject({ status: "queued" });
  expect(post).toHaveBeenLastCalledWith(`/travel-rule/trp/management/emails/${job.id}/retry`);

  post.mockResolvedValueOnce({ data: summary });
  await expect(apiModule.consumeTravelRuleEmailAccess("t".repeat(43))).resolves.toEqual(summary);
  expect(post).toHaveBeenLastCalledWith("/travel-rule/trp/email-access/consume", { token: "t".repeat(43) });
});

test.each([
  ["list", () => apiModule.listTravelRuleEmailJobs(), get],
  ["create", () => apiModule.createTravelRuleEmailInvitation(managementItems.transfers.id, "recipient@example.test"), post],
  ["retry", () => apiModule.retryTravelRuleEmailJob("66666666-6666-4666-8666-666666666666"), post],
  ["consume", () => apiModule.consumeTravelRuleEmailAccess("t".repeat(43)), post],
])("rejects malformed Travel Rule email %s responses", async (_name, invoke, method) => {
  method.mockResolvedValueOnce({ data: { token: "secret", unexpected: true } });
  await expect(invoke()).rejects.toThrow(/Invalid email/i);
});

test("gets, explicitly reveals, and rotates the service API key without browser persistence", async () => {
  const metadata = { configured: true, masked: "abcd********wxyz", updated_at: "2026-08-25T00:00:00.000Z" };
  const revealed = { api_key: "abcdefghijklmnopqrstuvwxyzABCDEF", updated_at: metadata.updated_at };
  get.mockResolvedValueOnce({ data: metadata });
  post.mockResolvedValueOnce({ data: revealed });
  put.mockResolvedValueOnce({ data: metadata });

  await expect(apiModule.getServiceApiKey()).resolves.toEqual(metadata);
  expect(get).toHaveBeenLastCalledWith("/auth/manage/configuration/service-api-key");
  await expect(apiModule.revealServiceApiKey()).resolves.toEqual(revealed);
  expect(post).toHaveBeenLastCalledWith("/auth/manage/configuration/service-api-key/reveal");
  await expect(apiModule.rotateServiceApiKey(revealed.api_key)).resolves.toEqual(metadata);
  expect(put).toHaveBeenLastCalledWith("/auth/manage/configuration/service-api-key", { api_key: revealed.api_key });
  expect(localStorage.getItem("serviceApiKey")).toBeNull();
});

test("loads strict TRP and Auth-only runtime configuration projections", async () => {
  const trp = {
    encryption: { active_key_id: "primary", retired_key_count: 1 },
    identity: { lei: "5493001KJTIIGC8Y1R12", name: "Example VASP", public_base_url: "https://trp.example.test:3001" },
    integrations: { email_mode: "smtp", oidc_enabled: true },
    mode: "trp",
    operations: { email_fallback_delay_minutes: 30, http_timeout_ms: 10000, retention_days: 1825, token_ttl_seconds: 86400 },
  };
  const auth = {
    encryption: null,
    identity: null,
    integrations: { email_mode: "disabled", oidc_enabled: false },
    mode: "auth",
    operations: null,
  };
  get.mockResolvedValueOnce({ data: trp }).mockResolvedValueOnce({ data: auth });

  await expect(apiModule.getRuntimeConfiguration()).resolves.toEqual(trp);
  expect(get).toHaveBeenLastCalledWith("/auth/manage/configuration/runtime");
  await expect(apiModule.getRuntimeConfiguration()).resolves.toEqual(auth);
});

test("manages scoped API clients using the existing management contract", async () => {
  const clientId = "10000000-0000-4000-8000-000000000001";
  const credentialId = "20000000-0000-4000-8000-000000000001";
  const expiresAt = "2027-01-01T00:00:00.000Z";
  const listed = {
    data: [{
      created_at: "2026-09-04T00:00:00.000Z",
      credentials: [{ created_at: "2026-09-04T00:00:00+00:00", expires_at: "2027-01-01T03:00:00+03:00", id: credentialId, revoked_at: null }],
      id: clientId,
      name: "custody-adapter",
      scopes: ["transfers:read", "transfers:write"],
      status: "active",
    }],
  };
  const created = {
    api_key: "defy_one-time-secret",
    createdAt: "2026-09-04T00:00:00.000Z",
    id: clientId,
    name: "custody-adapter",
    scopes: ["transfers:read"],
    status: "active",
  };
  const rotated = { api_key: "defy_rotated-secret", credentialId, expiresAt };
  get.mockResolvedValueOnce({ data: listed });
  post.mockResolvedValueOnce({ data: created }).mockResolvedValueOnce({ data: rotated });
  deleteRequest.mockResolvedValueOnce({ status: 204 });

  await expect(apiModule.listApiClients()).resolves.toEqual(listed.data);
  expect(get).toHaveBeenLastCalledWith("/auth/manage/api-clients");
  await expect(apiModule.createApiClient({ expiresAt, name: "custody-adapter", scopes: ["transfers:read"] })).resolves.toEqual(created);
  expect(post).toHaveBeenLastCalledWith("/auth/manage/api-clients", {
    expires_at: expiresAt,
    name: "custody-adapter",
    scopes: ["transfers:read"],
  });
  await expect(apiModule.rotateApiClientCredential(clientId, { expiresAt })).resolves.toEqual(rotated);
  expect(post).toHaveBeenLastCalledWith(`/auth/manage/api-clients/${clientId}/credentials`, { expires_at: expiresAt });
  await expect(apiModule.revokeApiClientCredential(clientId, credentialId)).resolves.toBe(true);
  expect(deleteRequest).toHaveBeenLastCalledWith(`/auth/manage/api-clients/${clientId}/credentials/${credentialId}`);
});

test.each([
  ["runtime", () => apiModule.getRuntimeConfiguration(), get, { mode: "trp", secret: "leaked" }],
  ["client list", () => apiModule.listApiClients(), get, { data: [{ id: "not-a-uuid" }] }],
  ["client create", () => apiModule.createApiClient({ name: "custody", scopes: ["transfers:read"] }), post, { api_key: "secret" }],
  ["credential rotation", () => apiModule.rotateApiClientCredential("client", {}), post, { api_key: "secret" }],
])("rejects a malformed %s response", async (_name, invoke, method, data) => {
  method.mockResolvedValueOnce({ data });

  await expect(invoke()).rejects.toThrow(/Invalid/);
});

test.each([
  ["client list", () => apiModule.listApiClients(), get, {
    data: [{
      created_at: "not-a-timestamp",
      credentials: [],
      id: "10000000-0000-4000-8000-000000000001",
      name: "custody-adapter",
      scopes: ["transfers:read"],
      status: "active",
    }],
  }],
  ["client create", () => apiModule.createApiClient({ name: "custody-adapter", scopes: ["transfers:read"] }), post, {
    api_key: "defy_one-time-secret",
    createdAt: "not-a-timestamp",
    id: "10000000-0000-4000-8000-000000000001",
    name: "custody-adapter",
    scopes: ["transfers:read"],
    status: "active",
  }],
  ["credential rotation", () => apiModule.rotateApiClientCredential("client", {}), post, {
    api_key: "defy_rotated-secret",
    credentialId: "20000000-0000-4000-8000-000000000001",
    expiresAt: "not-a-timestamp",
  }],
])("rejects an invalid timestamp in a %s response", async (_name, invoke, method, data) => {
  method.mockResolvedValueOnce({ data });

  await expect(invoke()).rejects.toThrow(/Invalid/);
});

test("rejects a non-204 API client credential revocation response", async () => {
  deleteRequest.mockResolvedValueOnce({ status: 200 });

  await expect(apiModule.revokeApiClientCredential("client", "credential")).rejects.toThrow(/Invalid/);
});

test.each([
  ["getTrpManagementResource", () => apiModule.getTrpManagementResource("transfers", "id"), get],
  ["createTrpTravelAddress", () => apiModule.createTrpTravelAddress({ beneficiary_reference: "x" }), post],
  ["createTrpTransfer", () => apiModule.createTrpTransfer({}), post],
  ["confirmTrpTransfer", () => apiModule.confirmTrpTransfer("id", { canceled: null }), post],
  ["retryTrpTransfer", () => apiModule.retryTrpTransfer("id"), post],
  ["getServiceApiKey", () => apiModule.getServiceApiKey(), get],
  ["revealServiceApiKey", () => apiModule.revealServiceApiKey(), post],
  ["rotateServiceApiKey", () => apiModule.rotateServiceApiKey("key"), put],
])("rejects malformed %s responses", async (_name, invoke, method) => {
  method.mockResolvedValueOnce({ data: {} });
  await expect(invoke()).rejects.toThrow(/Invalid/);
});

test("lists managed users with the exact pagination and optional search query", async () => {
  const response = {
    code: 0,
    message: "OK",
    data: [{
      email: "alice@example.invalid",
      role: "admin",
      active: true,
      created_at: "2026-08-25T12:00:00.000Z",
    }],
    page_count: 2,
  };
  get.mockResolvedValueOnce({ data: response });

  await expect(apiModule.listManagedUsers({ page: 2, limit: 25, search: " alice@example.invalid " })).resolves.toEqual({
    data: response.data,
    pageCount: 2,
  });
  expect(get).toHaveBeenLastCalledWith("/auth/manage/list?page=2&limit=25&search=alice%40example.invalid");
});

test("omits an empty managed-user search query", async () => {
  get.mockResolvedValueOnce({
    data: {
      code: 0,
      message: "OK",
      data: [],
      page_count: 0,
    },
  });

  await expect(apiModule.listManagedUsers({ search: "   " })).resolves.toEqual({ data: [], pageCount: 0 });
  expect(get).toHaveBeenLastCalledWith("/auth/manage/list?page=1&limit=10");
});

test.each([
  [{ code: 0, message: "OK", data: [], page_count: "1" }],
  [{ code: 0, message: "OK", data: [{ email: "x@example.invalid", role: "user", active: "yes", created_at: "2026-08-25" }], page_count: 1 }],
  [{ code: 1, message: "Not OK", data: [], page_count: 1 }],
  [{ code: 0, message: "OK", data: [], page_count: -1 }],
])("rejects malformed managed-user list responses", async (response) => {
  get.mockResolvedValueOnce({ data: response });

  await expect(apiModule.listManagedUsers()).rejects.toThrow("Invalid managed user list response");
});

test("sends only supported create and edit fields and validates standard responses", async () => {
  const response = { code: 0, message: "OK", data: null };
  post.mockResolvedValue({ data: response });

  await expect(apiModule.createManagedUser({ email: "create@example.invalid", role: "admin", key: "ignored" })).resolves.toEqual(response);
  expect(post).toHaveBeenLastCalledWith("/auth/manage/create", { email: "create@example.invalid", role: "admin" });

  await expect(apiModule.editManagedUser({ email: "edit@example.invalid", role: "user", apikey: "ignored" })).resolves.toEqual(response);
  expect(post).toHaveBeenLastCalledWith("/auth/manage/edit", { email: "edit@example.invalid", role: "user" });
});

test("rejects unsupported managed-user roles before sending a request", async () => {
  await expect(apiModule.createManagedUser({ email: "x@example.invalid", role: "super_admin" })).rejects.toThrow("Invalid managed user role");
  expect(post).not.toHaveBeenCalled();
});

test.each(["activateManagedUser", "deactivateManagedUser"])("sends only email to %s", async (helperName) => {
  post.mockResolvedValueOnce({ data: { code: 0, message: "OK", data: null } });

  await expect(apiModule[helperName]("person@example.invalid")).resolves.toEqual({ code: 0, message: "OK", data: null });
  expect(post).toHaveBeenLastCalledWith(`/auth/manage/${helperName.replace("ManagedUser", "")}`, { email: "person@example.invalid" });
});

test("rejects malformed managed-user mutation responses", async () => {
  post.mockResolvedValueOnce({ data: { code: 0, message: "OK", data: {} } });

  await expect(apiModule.createManagedUser({ email: "x@example.invalid", role: "user" })).rejects.toThrow("Invalid managed user mutation response");
});

test.each([
  ["editManagedUser", () => apiModule.editManagedUser({ email: "x@example.invalid", role: "user" })],
  ["activateManagedUser", () => apiModule.activateManagedUser("x@example.invalid")],
  ["deactivateManagedUser", () => apiModule.deactivateManagedUser("x@example.invalid")],
])("rejects malformed %s responses", async (_name, invoke) => {
  post.mockResolvedValueOnce({ data: { code: 0, message: "OK", data: {} } });

  await expect(invoke()).rejects.toThrow("Invalid managed user mutation response");
});

test.each([
  ["listManagedUsers", () => apiModule.listManagedUsers(), get],
  ["createManagedUser", () => apiModule.createManagedUser({ email: "x@example.invalid" }), post],
  ["editManagedUser", () => apiModule.editManagedUser({ email: "x@example.invalid", role: "user" }), post],
  ["activateManagedUser", () => apiModule.activateManagedUser("x@example.invalid"), post],
  ["deactivateManagedUser", () => apiModule.deactivateManagedUser("x@example.invalid"), post],
])("preserves upstream HTTP status for normalized %s failures", async (_name, invoke, method) => {
  method.mockRejectedValueOnce({ response: { status: 409, data: { message: "Conflict" } } });

  await expect(invoke()).rejects.toMatchObject({ message: "Conflict", status: 409 });
});

test.each([
  ["loginUser", () => apiModule.loginUser("a", "b")],
  ["getUserInfo", () => apiModule.getUserInfo()],
  ["forgotPassword", () => apiModule.forgotPassword("a")],
  ["resetPassword", () => apiModule.resetPassword("t", "p")],
  ["changePassword", () => apiModule.changePassword("o", "n")],
  ["listTrpInquiries", () => apiModule.listTrpInquiries()],
  ["getTrpInquiry", () => apiModule.getTrpInquiry("id")],
  ["decideTrpInquiry", () => apiModule.decideTrpInquiry("id", { decision: "rejected", reason: "risk" })],
])("%s normalizes upstream errors", async (_name, invoke) => {
  const method = ["getUserInfo", "listTrpInquiries", "getTrpInquiry"].includes(_name) ? get : post;
  method.mockRejectedValueOnce({ response: { data: { message: "API message" } } });
  await expect(invoke()).rejects.toMatchObject({ message: "API message" });
});
