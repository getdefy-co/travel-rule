import { toast } from "sonner";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ResourceDashboard } from "@/components/resource-dashboard";
import {
  confirmTrpTransfer,
  createTrpTransfer,
  createTrpTravelAddress,
  createTravelRuleEmailInvitation,
  getTrpManagementResource,
  listTrpManagementResources,
  retryTrpTransfer,
} from "@/lib/api";

let mockRole = "admin";
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: mockRole } }) }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn(), info: jest.fn(), dismiss: jest.fn() } }));

jest.mock("@/lib/api", () => ({
  confirmTrpTransfer: jest.fn(),
  createTrpTransfer: jest.fn(),
  createTrpTravelAddress: jest.fn(),
  createTravelRuleEmailInvitation: jest.fn(),
  getTrpManagementResource: jest.fn(),
  listTrpManagementResources: jest.fn(),
  retryTrpTransfer: jest.fn(),
}));

const transfer = {
  id: "11111111-1111-4111-8111-111111111111", protocol: "TRP", direction: "outbound", state: "approved",
  asset_dti: "4H95J0R2X", amount: "500", expires_at: "2026-08-28T00:00:00.000Z",
  retention_until: "2026-09-28T00:00:00.000Z", created_at: "2026-08-26T00:00:00.000Z", updated_at: "2026-08-26T01:00:00.000Z",
};
const message = {
  id: "22222222-2222-4222-8222-222222222222", transfer_id: transfer.id, phase: "resolution", direction: "outbound",
  logical_identifier: "33333333-3333-4333-8333-333333333333", request_identifier: "44444444-4444-4444-8444-444444444444",
  delivery_state: "failed", status_code: 503, error_code: "delivery_failed", superseded_by: null,
  created_at: "2026-08-26T00:00:00.000Z", delivered_at: null,
};
const token = {
  id: "55555555-5555-4555-8555-555555555555", transfer_id: transfer.id, purpose: "confirmation",
  expires_at: "2026-08-28T00:00:00.000Z", consumed_at: null, created_at: "2026-08-26T00:00:00.000Z",
};
const event = {
  id: "9223372036854775807", transfer_id: transfer.id, event_type: "inquiry_received", from_state: "pending", to_state: "approved",
  actor_user_id: "9007199254740992", actor_role: "admin", created_at: "2026-08-26T00:00:00.000Z",
};
const details = {
  transfers: { ...transfer, actions: { can_cancel: true, can_confirm: true, can_email: true, can_retry: true }, email_enabled: true, email_fallback_available_at: "2026-08-26T00:30:00.000Z", events: [event] },
  messages: { ...message, actions: { can_retry: true } },
  tokens: token,
  events: event,
};

beforeEach(() => {
  jest.resetAllMocks();
  mockRole = "admin";
  listTrpManagementResources.mockResolvedValue({ data: [transfer], total: 1, page: 1, limit: 20 });
  getTrpManagementResource.mockImplementation((resource) => Promise.resolve(details[resource]));
  confirmTrpTransfer.mockResolvedValue({ id: transfer.id, state: "canceled", retryable: false });
  createTrpTravelAddress.mockResolvedValue({ id: transfer.id, travel_address: "ta.example/address", expires_at: transfer.expires_at });
  createTrpTransfer.mockResolvedValue({ id: transfer.id, state: "pending", retryable: false });
  createTravelRuleEmailInvitation.mockResolvedValue({ id: "job-id" });
  retryTrpTransfer.mockResolvedValue({ id: transfer.id, retryable: false });
});

test("creates Travel Addresses and opens the structured outbound transfer form", async () => {
  const user = userEvent.setup();
  render(<ResourceDashboard resource="transfers" />);
  await screen.findByText(transfer.id);
  expect(within(screen.getByRole("table", { name: "Travel Rule transfers" })).getByText("Approved")).toHaveClass("border-emerald-500/30", "bg-emerald-500/10");
  await user.click(screen.getByRole("button", { name: "Create Travel Address" }));
  expect(screen.getByLabelText("Beneficiary reference")).toHaveAttribute("placeholder", "Enter the beneficiary reference");
  await user.type(screen.getByLabelText("Beneficiary reference"), "customer-42");
  await user.click(screen.getByRole("button", { name: "Create address" }));
  await waitFor(() => expect(createTrpTravelAddress).toHaveBeenCalledWith({ beneficiary_reference: "customer-42" }));

  await user.click(screen.getByRole("button", { name: "New Transfer" }));
  const transferDialog = screen.getByRole("dialog", { name: "New Transfer" });
  expect(within(transferDialog).getByRole("navigation", { name: "Transfer creation progress" })).toBeInTheDocument();
  expect(within(transferDialog).queryAllByRole("tab")).toHaveLength(0);
  expect(within(transferDialog).queryByLabelText("IVMS 101 JSON")).not.toBeInTheDocument();
  await user.click(within(transferDialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "New Transfer" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Create Travel Address" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Create Travel Address" })).not.toBeInTheDocument();
});

test("keeps the structured transfer dialog mounted while creation is pending", async () => {
  const user = userEvent.setup();
  let resolveTransfer;
  createTrpTransfer.mockReturnValueOnce(new Promise((resolve) => { resolveTransfer = resolve; }));
  render(<ResourceDashboard resource="transfers" />);
  await screen.findByText(transfer.id);

  await user.click(screen.getByRole("button", { name: "New Transfer" }));
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });
  fireEvent.change(within(dialog).getByLabelText("Travel Address"), { target: { value: "ta.example/address" } });
  fireEvent.change(within(dialog).getByLabelText("Asset DTI"), { target: { value: "4H95J0R2X" } });
  fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "25" } });
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
  fireEvent.change(within(dialog).getByLabelText("Originator primary identifier 1"), { target: { value: "Smith" } });
  fireEvent.change(within(dialog).getByLabelText("Originator customer number"), { target: { value: "originator-1" } });
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
  fireEvent.change(within(dialog).getByLabelText("Beneficiary legal name 1"), { target: { value: "Example Ltd" } });
  fireEvent.change(within(dialog).getByLabelText("Beneficiary customer number"), { target: { value: "beneficiary-1" } });
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
  await user.click(within(dialog).getByRole("button", { name: "Create transfer" }));
  await waitFor(() => expect(createTrpTransfer).toHaveBeenCalledTimes(1));

  expect(screen.getByRole("dialog", { name: "New Transfer" })).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Close dialog" })).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();

  await act(async () => { resolveTransfer({ id: transfer.id, state: "pending" }); });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "New Transfer" })).not.toBeInTheDocument());
});

test("shows a sanitized Travel Address creation error", async () => {
  const user = userEvent.setup();
  createTrpTravelAddress.mockRejectedValueOnce(new Error("sensitive backend detail"));
  render(<ResourceDashboard resource="transfers" />);
  await screen.findByText(transfer.id);

  await user.click(screen.getByRole("button", { name: "Create Travel Address" }));
  await user.type(screen.getByLabelText("Beneficiary reference"), "customer-42");
  await user.click(screen.getByRole("button", { name: "Create address" }));

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not create the Travel Address."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("fetches exact transfer detail and renders its real safe event timeline", async () => {
  const user = userEvent.setup();
  let resolveDetail;
  getTrpManagementResource.mockReturnValueOnce(new Promise((resolve) => { resolveDetail = resolve; }));
  render(<ResourceDashboard resource="transfers" />);

  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  expect(screen.getByRole("status", { name: "Loading resource details" })).toBeInTheDocument();
  await act(async () => { resolveDetail(details.transfers); });
  const detail = await screen.findByRole("dialog", { name: "Transfer details" });
  expect(getTrpManagementResource).toHaveBeenCalledWith("transfers", transfer.id);
  expect(within(detail).getByText(transfer.id)).toBeInTheDocument();
  await user.click(within(detail).getByRole("tab", { name: "Timeline" }));
  expect(within(detail).getByText("Inquiry received")).toBeInTheDocument();
  expect(within(detail).getByText(event.id)).toBeInTheDocument();
  expect(within(detail).queryByText(/operation_encrypted/i)).not.toBeInTheDocument();
});

test("renders only server-derived exact-admin transfer actions and uses the confirmation cancellation path", async () => {
  const user = userEvent.setup();
  render(<ResourceDashboard resource="transfers" />);
  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  const detail = await screen.findByRole("dialog", { name: "Transfer details" });
  await user.click(within(detail).getByRole("button", { name: "Cancel transfer" }));
  await user.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  await waitFor(() => expect(confirmTrpTransfer).toHaveBeenCalledWith(transfer.id, { canceled: null }));

  getTrpManagementResource.mockResolvedValueOnce({
    ...transfer, direction: "inbound", state: "pending",
    actions: { can_cancel: false, can_confirm: false, can_email: false, can_retry: false }, email_enabled: true, email_fallback_available_at: null, events: [],
  });
  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  const ineligible = await screen.findByRole("dialog", { name: "Transfer details" });
  expect(within(ineligible).queryByRole("button", { name: "Confirm transfer" })).not.toBeInTheDocument();
  expect(within(ineligible).queryByRole("button", { name: "Cancel transfer" })).not.toBeInTheDocument();
  expect(within(ineligible).queryByRole("button", { name: "Retry delivery" })).not.toBeInTheDocument();
});

test("starts parallel email invitations from eligible transfer detail and shows delayed availability", async () => {
  const user = userEvent.setup();
  render(<ResourceDashboard resource="transfers" />);
  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  await user.click(within(await screen.findByRole("dialog", { name: "Transfer details" })).getByRole("button", { name: "Email recipient" }));
  await user.type(screen.getByLabelText("Recipient email"), "recipient@example.test");
  await user.click(screen.getByRole("button", { name: "Send email" }));
  await waitFor(() => expect(createTravelRuleEmailInvitation).toHaveBeenCalledWith(transfer.id, "recipient@example.test"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Send transfer email" })).not.toBeInTheDocument());
  await user.click(within(screen.getByRole("dialog", { name: "Transfer details" })).getByRole("button", { name: "Close sheet" }));

  getTrpManagementResource.mockResolvedValueOnce({
    ...details.transfers,
    actions: { ...details.transfers.actions, can_email: false },
    email_fallback_available_at: "2099-08-26T00:30:00.000Z",
    expires_at: "2099-08-28T00:00:00.000Z",
  });
  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/Email fallback will be available at/), expect.any(Object)));
  const delayedButton = screen.getByRole("button", { name: "Email recipient" });
  expect(delayedButton).toBeDisabled();
  expect(delayedButton).not.toHaveAttribute("aria-describedby");
});

test("keeps the email action active for a server-authorized rejected outbound transfer", async () => {
  const user = userEvent.setup();
  getTrpManagementResource.mockResolvedValueOnce({ ...details.transfers, state: "rejected" });
  render(<ResourceDashboard resource="transfers" />);

  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  const emailButton = await screen.findByRole("button", { name: "Email recipient" });
  expect(emailButton).toBeEnabled();
  await user.click(emailButton);
  expect(screen.getByRole("dialog", { name: "Send transfer email" })).toBeInTheDocument();
});

test.each(["approved", "rejected"])("shows why an inbound %s transfer cannot use email fallback", async (state) => {
  const user = userEvent.setup();
  getTrpManagementResource.mockResolvedValueOnce({
    ...details.transfers,
    actions: { can_cancel: false, can_confirm: false, can_email: false, can_retry: false },
    direction: "inbound",
    email_fallback_available_at: null,
    state,
  });
  render(<ResourceDashboard resource="transfers" />);

  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Email fallback is available only for outbound transfers.", expect.any(Object)));
  expect(screen.queryByText("Email fallback is available only for outbound transfers.")).not.toBeInTheDocument();
  const emailButton = screen.getByRole("button", { name: "Email recipient" });
  expect(emailButton).toBeDisabled();
  expect(emailButton).not.toHaveAttribute("aria-describedby");
  await user.click(emailButton);
  expect(screen.queryByRole("dialog", { name: "Send transfer email" })).not.toBeInTheDocument();
  expect(createTravelRuleEmailInvitation).not.toHaveBeenCalled();
});

test("shows why an expired outbound transfer cannot use email fallback", async () => {
  const user = userEvent.setup();
  getTrpManagementResource.mockResolvedValueOnce({
    ...details.transfers,
    actions: { ...details.transfers.actions, can_email: false },
    expires_at: "2020-01-01T00:00:00.000Z",
  });
  render(<ResourceDashboard resource="transfers" />);

  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Email fallback is unavailable because this transfer has expired.", expect.any(Object)));
  expect(screen.queryByText("Email fallback is unavailable because this transfer has expired.")).not.toBeInTheDocument();
  const emailButton = screen.getByRole("button", { name: "Email recipient" });
  expect(emailButton).toBeDisabled();
  expect(emailButton).not.toHaveAttribute("aria-describedby");
});

test.each([
  [false, "approved", "Email fallback is unavailable."],
  [true, "confirmed", "Email fallback is unavailable after the transfer reaches a terminal state."],
  [true, "approved", "Email fallback is unavailable."],
])("shows the server-owned email unavailable reason for enabled=%s state=%s", async (emailEnabled, state, expectedReason) => {
  const user = userEvent.setup();
  getTrpManagementResource.mockResolvedValueOnce({
    ...details.transfers,
    actions: { ...details.transfers.actions, can_email: false },
    email_enabled: emailEnabled,
    expires_at: "2099-08-28T00:00:00.000Z",
    state,
  });
  render(<ResourceDashboard resource="transfers" />);

  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expectedReason, expect.any(Object)));
  expect(screen.queryByText(expectedReason)).not.toBeInTheDocument();
  const emailButton = screen.getByRole("button", { name: "Email recipient" });
  expect(emailButton).toBeDisabled();
  expect(emailButton).not.toHaveAttribute("aria-describedby");
});

test("hides every mutation control from normal users while retaining fetched metadata", async () => {
  const user = userEvent.setup();
  mockRole = "user";
  render(<ResourceDashboard resource="transfers" />);
  expect(await screen.findByText(transfer.id)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "New Transfer" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create Travel Address" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: `View transfer ${transfer.id}` }));
  const detail = await screen.findByRole("dialog", { name: "Transfer details" });
  expect(within(detail).queryByRole("button", { name: "Confirm transfer" })).not.toBeInTheDocument();
  expect(within(detail).queryByRole("button", { name: "Retry delivery" })).not.toBeInTheDocument();
  expect(within(detail).queryByRole("button", { name: "Email recipient" })).not.toBeInTheDocument();
});

test("retries only a server-eligible message from fetched detail", async () => {
  const user = userEvent.setup();
  listTrpManagementResources.mockResolvedValueOnce({ data: [message], total: 1, page: 1, limit: 20 });
  render(<ResourceDashboard resource="messages" />);
  await user.click(await screen.findByRole("button", { name: `View message ${message.id}` }));
  const detail = await screen.findByRole("dialog", { name: "Message details" });
  expect(screen.queryByRole("button", { name: "Retry message delivery" })).not.toBeInTheDocument();
  await user.click(within(detail).getByRole("button", { name: "Retry delivery" }));
  const confirmation = screen.getByRole("alertdialog", { name: "Retry delivery?" });
  await user.click(within(confirmation).getByRole("button", { name: "Retry delivery" }));
  await waitFor(() => expect(retryTrpTransfer).toHaveBeenCalledWith(transfer.id));
});

test("renders received inbound messages in list and detail metadata", async () => {
  const user = userEvent.setup();
  const receivedMessage = {
    ...message,
    direction: "inbound",
    delivery_state: "received",
    status_code: 200,
    error_code: null,
  };
  listTrpManagementResources.mockResolvedValueOnce({ data: [receivedMessage], total: 1, page: 1, limit: 20 });
  getTrpManagementResource.mockResolvedValueOnce({ ...receivedMessage, actions: { can_retry: false } });
  render(<ResourceDashboard resource="messages" />);

  expect(await screen.findByText("Received")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: `View message ${receivedMessage.id}` }));
  const detail = await screen.findByRole("dialog", { name: "Message details" });
  expect(within(detail).getByText("Received")).toBeInTheDocument();
  expect(within(detail).queryByRole("button", { name: "Retry delivery" })).not.toBeInTheDocument();
});

test("catches action rejection, localizes feedback, and restores disabled busy controls", async () => {
  const user = userEvent.setup();
  let rejectAction;
  confirmTrpTransfer.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectAction = reject; }));
  render(<ResourceDashboard resource="transfers" />);
  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  const detail = await screen.findByRole("dialog", { name: "Transfer details" });
  await user.click(within(detail).getByRole("button", { name: "Cancel transfer" }));
  const confirmation = screen.getByRole("alertdialog", { name: "Cancel transfer?" });
  const submit = within(confirmation).getByRole("button", { name: "Confirm cancellation" });
  await user.click(submit);
  expect(submit).toBeDisabled();
  expect(submit).toHaveAttribute("aria-busy", "true");
  expect(within(confirmation).getByRole("button", { name: "Cancel" })).toBeDisabled();
  rejectAction(new Error("raw backend message"));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not update the transfer."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(submit).toBeEnabled();
  await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog", { name: "Cancel transfer?" })).not.toBeInTheDocument();
});

test("confirms and retries an eligible transfer through supported domain actions", async () => {
  const user = userEvent.setup();
  render(<ResourceDashboard resource="transfers" />);
  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  let detail = await screen.findByRole("dialog", { name: "Transfer details" });
  await user.click(within(detail).getByRole("button", { name: "Confirm transfer" }));
  expect(screen.getByLabelText("Transaction ID")).toHaveAttribute("placeholder", "Enter the settlement transaction ID");
  await user.type(screen.getByLabelText("Transaction ID"), "tx-123");
  await user.click(screen.getByRole("button", { name: "Confirm transfer" }));
  await waitFor(() => expect(confirmTrpTransfer).toHaveBeenCalledWith(transfer.id, { txid: "tx-123" }));

  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  detail = await screen.findByRole("dialog", { name: "Transfer details" });
  await user.click(within(detail).getByRole("button", { name: "Retry delivery" }));
  const confirmation = screen.getByRole("alertdialog", { name: "Retry delivery?" });
  await user.click(within(confirmation).getByRole("button", { name: "Retry delivery" }));
  await waitFor(() => expect(retryTrpTransfer).toHaveBeenCalledWith(transfer.id));
});

test("shows localized detail, list, and empty errors with retry paths", async () => {
  const user = userEvent.setup();
  getTrpManagementResource.mockRejectedValueOnce(new Error("raw database error")).mockResolvedValueOnce(details.transfers);
  const { unmount } = render(<ResourceDashboard resource="transfers" />);
  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not load the Travel Rule resource."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry details" }));
  expect(await screen.findByRole("tab", { name: "Timeline" })).toBeInTheDocument();
  unmount();

  listTrpManagementResources.mockRejectedValueOnce(new Error("offline"));
  render(<ResourceDashboard key="failed" resource="events" />);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not load Travel Rule resources."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  listTrpManagementResources.mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 20 });
  await user.click(screen.getByRole("button", { name: "Retry resources" }));
  expect(await screen.findByText("No events found.")).toBeInTheDocument();
});

test("renders BIGINT event strings and resource-specific read-only details without placeholder tabs", async () => {
  const user = userEvent.setup();
  listTrpManagementResources.mockResolvedValueOnce({ data: [token], total: 1, page: 1, limit: 20 });
  const { unmount } = render(<ResourceDashboard resource="tokens" />);
  await user.click(await screen.findByRole("button", { name: `View token ${token.id}` }));
  let detail = await screen.findByRole("dialog", { name: "Token details" });
  expect(within(detail).getByText("N/A")).toBeInTheDocument();
  expect(within(detail).queryByRole("tab")).not.toBeInTheDocument();
  unmount();

  listTrpManagementResources.mockResolvedValueOnce({ data: [event], total: 1, page: 1, limit: 20 });
  render(<ResourceDashboard resource="events" />);
  await user.click(await screen.findByRole("button", { name: `View event ${event.id}` }));
  detail = await screen.findByRole("dialog", { name: "Event details" });
  expect(getTrpManagementResource).toHaveBeenLastCalledWith("events", event.id);
  expect(within(detail).getByText(event.actor_user_id)).toBeInTheDocument();
  expect(within(detail).getByText("Admin")).toBeInTheDocument();
  expect(within(detail).queryByRole("tab")).not.toBeInTheDocument();
});

test("filters on the server, finds a match outside page one, and resets pagination", async () => {
  const user = userEvent.setup();
  const outsideMatch = { ...transfer, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  listTrpManagementResources.mockImplementation((_resource, options) => {
    if (options.search === "outside") {
      return Promise.resolve({ data: [outsideMatch], total: 1, page: 1, limit: 20 });
    }
    return Promise.resolve({ data: [transfer], total: 21, page: options.page, limit: options.limit });
  });
  render(<ResourceDashboard resource="transfers" />);
  await screen.findByText(transfer.id);
  await user.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(listTrpManagementResources).toHaveBeenLastCalledWith("transfers", {
    direction: "all", limit: 20, page: 2, search: "", state: "all",
  }));
  await user.click(screen.getByRole("button", { name: "Previous" }));
  await waitFor(() => expect(listTrpManagementResources).toHaveBeenLastCalledWith("transfers", {
    direction: "all", limit: 20, page: 1, search: "", state: "all",
  }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByRole("textbox", { name: "Search transfers" }), "outside");
  expect(await screen.findByText(outsideMatch.id)).toBeInTheDocument();
  await waitFor(() => expect(listTrpManagementResources).toHaveBeenLastCalledWith("transfers", {
    direction: "all", limit: 20, page: 1, search: "outside", state: "all",
  }));
  expect(screen.getByText("1 total")).toBeInTheDocument();
});

test("sends direction, state, and row-limit controls to the server", async () => {
  const user = userEvent.setup();
  render(<ResourceDashboard resource="transfers" />);
  await screen.findByText(transfer.id);
  await user.click(screen.getByRole("combobox", { name: "Direction filter" }));
  await user.click(screen.getByRole("option", { name: "Outbound" }));
  await user.click(screen.getByRole("combobox", { name: "State filter" }));
  await user.click(screen.getByRole("option", { name: "Approved" }));
  await user.click(screen.getByRole("combobox", { name: "Rows per page" }));
  await user.click(screen.getByRole("option", { name: "10" }));
  await waitFor(() => expect(listTrpManagementResources).toHaveBeenLastCalledWith("transfers", {
    direction: "outbound", limit: 10, page: 1, search: "", state: "approved",
  }));
});

test.each([
  ["messages", message, "Search messages", [["Direction filter", "Inbound"], ["Phase filter", "Inquiry"], ["Delivery state filter", "Received"]], { direction: "inbound", phase: "inquiry", delivery_state: "received" }],
  ["tokens", token, "Search tokens", [["Purpose filter", "Resolution"], ["Token status filter", "Active"]], { purpose: "resolution", status: "active" }],
  ["events", event, "Search events", [["Event type filter", "Manual approval"], ["Previous state filter", "Pending"], ["Next state filter", "Approved"]], { event_type: "manual_approval", from_state: "pending", to_state: "approved" }],
])("searches and combines %s filters across pages", async (resource, item, searchLabel, selections, expectedFilters) => {
  const user = userEvent.setup();
  listTrpManagementResources.mockImplementation((_resource, options) => Promise.resolve({
    data: [item], total: options.search === "outside" ? 1 : 21, page: options.page, limit: options.limit,
  }));
  render(<ResourceDashboard resource={resource} />);
  await screen.findByRole("button", { name: new RegExp(`View .*${item.id}`) });
  await user.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(listTrpManagementResources).toHaveBeenLastCalledWith(resource, expect.objectContaining({ page: 2 })));
  await user.type(screen.getByRole("textbox", { name: searchLabel }), "outside");
  expect(await screen.findByText("1 total")).toBeInTheDocument();
  for (const [label, value] of selections) {
    await user.click(screen.getByRole("combobox", { name: label }));
    await user.click(screen.getByRole("option", { name: value, exact: true }));
  }
  await waitFor(() => expect(listTrpManagementResources).toHaveBeenLastCalledWith(resource, { ...expectedFilters, search: "outside", limit: 20, page: 1 }));
});

test("ignores an older resource result and rejection after search changes", async () => {
  const user = userEvent.setup();
  let resolveOld;
  let rejectOld;
  listTrpManagementResources.mockResolvedValue({ data: [token], total: 21, page: 1, limit: 20 });
  render(<ResourceDashboard resource="tokens" />);
  await screen.findByText(token.id);
  listTrpManagementResources.mockImplementation((_resource, options) => {
    if (!options.search) return new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    return Promise.resolve({ data: [], total: 0, page: 1, limit: 20 });
  });
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByRole("textbox", { name: "Search tokens" }), "absent");
  expect(await screen.findByText("0 total")).toBeInTheDocument();
  await act(async () => resolveOld({ data: [token], total: 21, page: 2, limit: 20 }));
  expect(screen.queryByText(token.id)).not.toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: "Search tokens" }));
  await user.type(screen.getByRole("textbox", { name: "Search tokens" }), "absent");
  await act(async () => rejectOld(new Error("stale failure")));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test.each(["resolve", "reject"])("validates the Travel Address form, prevents duplicates, and ignores a %s after close", async (outcome) => {
  let finish;
  createTrpTravelAddress.mockReturnValueOnce(new Promise((resolve, reject) => { finish = outcome === "resolve" ? resolve : reject; }));
  const user = userEvent.setup();
  render(<ResourceDashboard resource="transfers" />);
  await screen.findByText(transfer.id);
  await user.click(screen.getByRole("button", { name: "Create Travel Address" }));
  await user.click(screen.getByRole("button", { name: "Create address" }));
  expect(toast.error).toHaveBeenCalledWith("This field is required.");
  const input = screen.getByLabelText("Beneficiary reference");
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: "customer-42" } });
  const submit = screen.getByRole("button", { name: "Create address" });
  act(() => { submit.click(); submit.click(); });
  expect(createTrpTravelAddress).toHaveBeenCalledTimes(1);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Create Travel Address" })).not.toBeInTheDocument();
  toast.error.mockClear();
  await act(async () => { finish(new Error("late response")); });
  expect(toast.error).not.toHaveBeenCalled();
  expect(listTrpManagementResources).toHaveBeenCalledTimes(1);
});

test.each(["resolve", "reject"])("blocks duplicate transfer actions and ignores a %s after unmount", async (outcome) => {
  let finish;
  confirmTrpTransfer.mockReturnValueOnce(new Promise((resolve, reject) => { finish = outcome === "resolve" ? resolve : reject; }));
  const user = userEvent.setup();
  const { unmount } = render(<ResourceDashboard resource="transfers" />);
  await user.click(await screen.findByRole("button", { name: `View transfer ${transfer.id}` }));
  await user.click(await screen.findByRole("button", { name: "Cancel transfer" }));
  const confirm = screen.getByRole("button", { name: "Confirm cancellation" });
  act(() => { confirm.click(); confirm.click(); });
  expect(confirmTrpTransfer).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => { finish(new Error("late response")); });
  expect(toast.error).not.toHaveBeenCalled();
  expect(listTrpManagementResources).toHaveBeenCalledTimes(1);
});
