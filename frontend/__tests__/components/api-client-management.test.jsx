import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { ApiClientManagement } from "@/components/api-client-management";
import {
  createApiClient,
  listApiClients,
  revokeApiClientCredential,
  rotateApiClientCredential,
} from "@/lib/api";

jest.mock("@/lib/api", () => ({
  createApiClient: jest.fn(),
  listApiClients: jest.fn(),
  revokeApiClientCredential: jest.fn(),
  rotateApiClientCredential: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { dismiss: jest.fn(), error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));

const legacyClient = {
  created_at: "2026-08-01T00:00:00.000Z",
  credentials: [],
  id: "00000000-0000-4000-8000-000000000001",
  name: "legacy-service-api-key",
  scopes: ["transfers:read"],
  status: "active",
};
const scopedClient = {
  created_at: "2026-08-02T00:00:00.000Z",
  credentials: [
    { created_at: "2026-08-04T00:00:00.000Z", expires_at: "2099-08-04T00:00:00.000Z", id: "33333333-3333-4333-8333-333333333333", revoked_at: null },
    { created_at: "2026-08-03T00:00:00.000Z", expires_at: null, id: "22222222-2222-4222-8222-222222222222", revoked_at: "2026-08-05T00:00:00.000Z" },
    { created_at: "2026-08-02T00:00:00.000Z", expires_at: "2026-08-03T00:00:00.000Z", id: "11111111-1111-4111-8111-111111111111", revoked_at: null },
  ],
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "settlement-worker",
  scopes: ["transfers:read", "transfers:write"],
  status: "active",
};
const createdClient = {
  api_key: "defy_created-secret",
  createdAt: "2026-09-04T00:00:00.000Z",
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "reporting-worker",
  scopes: ["transfers:read"],
  status: "active",
};

const setItemSpy = jest.spyOn(Storage.prototype, "setItem");

const clickTwiceBeforeReactFlush = (control) => {
  fireEvent.click(control);
  fireEvent.click(control);
};

beforeEach(() => {
  jest.resetAllMocks();
  setItemSpy.mockClear();
  listApiClients.mockResolvedValue([legacyClient, scopedClient]);
  createApiClient.mockResolvedValue(createdClient);
  rotateApiClientCredential.mockResolvedValue({ api_key: "defy_rotated-secret", credentialId: "44444444-4444-4444-8444-444444444444", expiresAt: null });
  revokeApiClientCredential.mockResolvedValue(true);
});

test("lists scoped clients, credential states, and filters the canonical legacy client", async () => {
  render(<ApiClientManagement />);

  expect(await screen.findByRole("heading", { name: "Scoped API Clients" })).toBeInTheDocument();
  expect(await screen.findByText("settlement-worker")).toBeInTheDocument();
  expect(screen.queryByText("legacy-service-api-key")).not.toBeInTheDocument();
  expect(screen.getByText("transfers:read")).toHaveClass("border-slate-500/30", "bg-slate-500/10");
  expect(screen.getByText("transfers:write")).toHaveClass("border-slate-500/30", "bg-slate-500/10");
  expect(screen.getAllByText("Active", { selector: "[data-slot='badge']" })[0]).toHaveClass("border-emerald-500/30", "bg-emerald-500/10");
  expect(screen.getByText("Revoked")).toHaveClass("border-slate-500/30", "bg-slate-500/10");
  expect(screen.getByText("Expired")).toHaveClass("border-violet-500/30", "bg-violet-500/10");
  expect(screen.getAllByRole("button", { name: "Revoke credential" })).toHaveLength(1);
});

test("shows disabled client credentials as disabled while preserving explicit revocation", async () => {
  const user = userEvent.setup();
  const disabledClient = {
    ...scopedClient,
    credentials: [scopedClient.credentials[0]],
    name: "disabled-worker",
    status: "disabled",
  };
  listApiClients.mockResolvedValueOnce([disabledClient]);
  render(<ApiClientManagement />);

  const client = await screen.findByRole("group", { name: "API client disabled-worker" });
  expect(within(client).getAllByText("Disabled", { selector: "[data-slot='badge']" })).toHaveLength(2);
  expect(within(client).getByRole("button", { name: "Rotate credential" })).toBeDisabled();

  await user.click(within(client).getByRole("button", { name: "Revoke credential" }));
  await user.click(screen.getByRole("button", { name: "Confirm revoke" }));
  await waitFor(() => expect(revokeApiClientCredential).toHaveBeenCalledWith(disabledClient.id, disabledClient.credentials[0].id));
});

test("validates and creates a client, then clears the one-time secret when closed", async () => {
  const user = userEvent.setup();
  render(<ApiClientManagement />);
  await screen.findByText("settlement-worker");

  await user.click(screen.getByRole("button", { name: "Create API client" }));
  await user.type(screen.getByLabelText("Client name"), "Bad Name");
  await user.click(screen.getByRole("button", { name: "Create client" }));
  expect(toast.error).toHaveBeenCalledWith("2 fields need attention. Client name: Use 3–64 lowercase letters, numbers, dots, underscores, or hyphens.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Client name")).toHaveFocus();
  expect(screen.getByLabelText("Client name")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("transfers:read")).toHaveAttribute("aria-invalid", "true");
  expect(createApiClient).not.toHaveBeenCalled();

  await user.clear(screen.getByLabelText("Client name"));
  await user.type(screen.getByLabelText("Client name"), "reporting-worker");
  await user.click(screen.getByLabelText("transfers:read"));
  await user.click(screen.getByRole("button", { name: "Create client" }));

  await waitFor(() => expect(createApiClient).toHaveBeenCalledWith({ expiresAt: null, name: "reporting-worker", scopes: ["transfers:read"] }));
  const secretDialog = await screen.findByRole("dialog", { name: "Save API credential" });
  expect(within(secretDialog).getByDisplayValue("defy_created-secret")).toHaveAttribute("readonly");
  expect(setItemSpy).not.toHaveBeenCalled();
  await user.click(within(secretDialog).getByRole("button", { name: "Copy credential" }));
  expect(toast.success).toHaveBeenCalledWith("Copied to clipboard.");
  await user.click(within(secretDialog).getByRole("button", { name: "I saved it" }));
  expect(screen.queryByDisplayValue("defy_created-secret")).not.toBeInTheDocument();
  expect(setItemSpy).not.toHaveBeenCalled();
});

test("validates scope and future expiry and keeps mutation failures recoverable", async () => {
  const user = userEvent.setup();
  createApiClient.mockRejectedValueOnce(new Error("Could not create the API client."));
  rotateApiClientCredential.mockRejectedValueOnce(new Error("Could not rotate the API client credential."));
  revokeApiClientCredential.mockRejectedValueOnce(new Error("Could not revoke the API client credential."));
  render(<ApiClientManagement />);
  const client = await screen.findByRole("group", { name: "API client settlement-worker" });

  await user.click(screen.getByRole("button", { name: "Create API client" }));
  await user.type(screen.getByLabelText("Client name"), "reporting-worker");
  await user.click(screen.getByRole("button", { name: "Create client" }));
  expect(toast.error).toHaveBeenCalledWith("Select at least one unique scope.");
  await user.click(screen.getByLabelText("transfers:read"));
  await user.click(screen.getByLabelText("transfers:read"));
  await user.click(screen.getByRole("button", { name: "Create client" }));
  expect(toast.error).toHaveBeenLastCalledWith("Select at least one unique scope.");
  await user.click(screen.getByLabelText("transfers:read"));
  fireEvent.change(screen.getByLabelText("Credential expiry"), { target: { value: "2020-01-01T00:00" } });
  await user.click(screen.getByRole("button", { name: "Create client" }));
  expect(toast.error).toHaveBeenLastCalledWith("Choose a valid future expiry.");
  const futureExpiry = "2099-01-01T00:00";
  const futureExpiryIso = new Date(futureExpiry).toISOString();
  fireEvent.change(screen.getByLabelText("Credential expiry"), { target: { value: futureExpiry } });
  await user.click(screen.getByRole("button", { name: "Create client" }));
  await waitFor(() => expect(createApiClient).toHaveBeenCalledWith({ expiresAt: futureExpiryIso, name: "reporting-worker", scopes: ["transfers:read"] }));
  expect(toast.error).toHaveBeenCalledWith("Could not create the API client.");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(within(client).getByRole("button", { name: "Rotate credential" }));
  fireEvent.change(screen.getByLabelText("Credential expiry"), { target: { value: "2020-01-01T00:00" } });
  await user.click(screen.getByRole("button", { name: "Create overlapping credential" }));
  expect(toast.error).toHaveBeenLastCalledWith("Choose a valid future expiry.");
  fireEvent.change(screen.getByLabelText("Credential expiry"), { target: { value: futureExpiry } });
  await user.click(screen.getByRole("button", { name: "Create overlapping credential" }));
  await waitFor(() => expect(rotateApiClientCredential).toHaveBeenCalledWith(scopedClient.id, { expiresAt: futureExpiryIso }));
  expect(toast.error).toHaveBeenCalledWith("Could not rotate the API client credential.");
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(within(client).getByRole("button", { name: "Revoke credential" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(revokeApiClientCredential).not.toHaveBeenCalled();
  await user.click(within(client).getByRole("button", { name: "Revoke credential" }));
  await user.click(screen.getByRole("button", { name: "Confirm revoke" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not revoke the API client credential."));
});

test("supports closing rotation and one-time-secret dialogs through their open-state callbacks", async () => {
  const user = userEvent.setup();
  render(<ApiClientManagement />);
  const client = await screen.findByRole("group", { name: "API client settlement-worker" });

  await user.click(within(client).getByRole("button", { name: "Rotate credential" }));
  await user.click(within(screen.getByRole("dialog", { name: "Rotate API credential" })).getByRole("button", { name: "Close dialog" }));
  expect(screen.queryByRole("dialog", { name: "Rotate API credential" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Create API client" }));
  await user.type(screen.getByLabelText("Client name"), "reporting-worker");
  await user.click(screen.getByLabelText("transfers:read"));
  await user.click(screen.getByRole("button", { name: "Create client" }));
  const secretDialog = await screen.findByRole("dialog", { name: "Save API credential" });
  await user.click(within(secretDialog).getByRole("button", { name: "Close dialog" }));
  expect(screen.queryByDisplayValue("defy_created-secret")).not.toBeInTheDocument();
});

test("shows clipboard failure, rotates with overlap, and revokes only after confirmation", async () => {
  const user = userEvent.setup();
  const clipboardSpy = jest.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
  render(<ApiClientManagement />);
  const client = await screen.findByRole("group", { name: "API client settlement-worker" });

  await user.click(within(client).getByRole("button", { name: "Rotate credential" }));
  await user.click(screen.getByRole("button", { name: "Create overlapping credential" }));
  await waitFor(() => expect(rotateApiClientCredential).toHaveBeenCalledWith(scopedClient.id, { expiresAt: null }));
  expect(revokeApiClientCredential).not.toHaveBeenCalled();
  const secretDialog = await screen.findByRole("dialog", { name: "Save API credential" });
  await user.click(within(secretDialog).getByRole("button", { name: "Copy credential" }));
  expect(clipboardSpy).toHaveBeenCalledWith("defy_rotated-secret");
  expect(toast.error).toHaveBeenCalledWith("Could not copy to clipboard.");
  await user.click(within(secretDialog).getByRole("button", { name: "I saved it" }));

  await screen.findByRole("group", { name: "API client settlement-worker" });
  await waitFor(() => expect(screen.queryByLabelText("Loading API clients")).not.toBeInTheDocument());
  const refreshedClient = await screen.findByRole("group", { name: "API client settlement-worker" });
  await user.click(within(refreshedClient).getByRole("button", { name: "Revoke credential" }));
  expect(screen.getByRole("alertdialog", { name: "Revoke API credential?" })).toBeInTheDocument();
  expect(revokeApiClientCredential).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Confirm revoke" }));
  await waitFor(() => expect(revokeApiClientCredential).toHaveBeenCalledWith(scopedClient.id, "33333333-3333-4333-8333-333333333333"));
});

test("owns its list error and retry state", async () => {
  const user = userEvent.setup();
  listApiClients.mockRejectedValueOnce(new Error("offline"));
  render(<ApiClientManagement />);

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not load API clients."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry API clients" }));
  expect(await screen.findByText("settlement-worker")).toBeInTheDocument();
});

test("cancels initial and deferred list work when unmounted", async () => {
  const { unmount } = render(<ApiClientManagement />);
  unmount();
  await act(async () => Promise.resolve());
  expect(listApiClients).not.toHaveBeenCalled();

  let resolveRequest;
  listApiClients.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
  const { unmount: unmountPending } = render(<ApiClientManagement />);
  await waitFor(() => expect(listApiClients).toHaveBeenCalledTimes(1));
  unmountPending();
  await act(async () => resolveRequest([scopedClient]));
});

test("owns persistent credential warnings and ignores clipboard failure after the secret closes", async () => {
  const user = userEvent.setup();
  render(<ApiClientManagement />);
  const client = await screen.findByRole("group", { name: "API client settlement-worker" });

  await user.click(within(client).getByRole("button", { name: "Rotate credential" }));
  expect(toast.warning).toHaveBeenCalledWith(
    "The existing credential remains active so clients can migrate without downtime. Revoke it separately after rollout.",
    { duration: Infinity, id: "api-client-rotation-overlap-warning" },
  );
  await user.click(within(screen.getByRole("dialog", { name: "Rotate API credential" })).getByRole("button", { name: "Cancel" }));
  expect(toast.dismiss).toHaveBeenCalledWith("api-client-rotation-overlap-warning");

  await user.click(screen.getByRole("button", { name: "Create API client" }));
  await user.type(screen.getByLabelText("Client name"), "reporting-worker");
  await user.click(screen.getByLabelText("transfers:read"));
  await user.click(screen.getByRole("button", { name: "Create client" }));
  const secretDialog = await screen.findByRole("dialog", { name: "Save API credential" });
  expect(toast.warning).toHaveBeenCalledWith(
    "Store the credential securely before closing this dialog. It cannot be revealed again.",
    { duration: Infinity, id: "api-client-one-time-secret-warning" },
  );

  let rejectCopy;
  const pendingCopy = new Promise((_resolve, reject) => {
    rejectCopy = reject;
  });
  jest.spyOn(navigator.clipboard, "writeText").mockReturnValueOnce(pendingCopy);
  await user.click(within(secretDialog).getByRole("button", { name: "Copy credential" }));
  toast.error.mockClear();
  await user.click(within(secretDialog).getByRole("button", { name: "I saved it" }));
  await act(async () => rejectCopy(new Error("denied")));

  expect(toast.dismiss).toHaveBeenCalledWith("api-client-one-time-secret-warning");
  expect(toast.error).not.toHaveBeenCalled();
});

test("deduplicates mutations and keeps pending confirmation dialogs open", async () => {
  const user = userEvent.setup();
  let resolveCreate;
  let resolveRotation;
  let resolveRevoke;
  createApiClient.mockReturnValueOnce(new Promise((resolve) => {
    resolveCreate = resolve;
  }));
  rotateApiClientCredential.mockReturnValueOnce(new Promise((resolve) => {
    resolveRotation = resolve;
  }));
  revokeApiClientCredential.mockReturnValueOnce(new Promise((resolve) => {
    resolveRevoke = resolve;
  }));
  render(<ApiClientManagement />);
  await screen.findByText("settlement-worker");

  await user.click(screen.getByRole("button", { name: "Create API client" }));
  await user.type(screen.getByLabelText("Client name"), "reporting-worker");
  await user.click(screen.getByLabelText("transfers:read"));
  const createButton = screen.getByRole("button", { name: "Create client" });
  act(() => {
    clickTwiceBeforeReactFlush(createButton);
  });
  expect(createApiClient).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(screen.getByRole("dialog", { name: "Create API client" })).toBeInTheDocument();
  await act(async () => resolveCreate(createdClient));
  await user.click(within(await screen.findByRole("dialog", { name: "Save API credential" })).getByRole("button", { name: "I saved it" }));

  const client = await screen.findByRole("group", { name: "API client settlement-worker" });
  await user.click(within(client).getByRole("button", { name: "Rotate credential" }));
  const rotateButton = screen.getByRole("button", { name: "Create overlapping credential" });
  act(() => {
    clickTwiceBeforeReactFlush(rotateButton);
  });
  expect(rotateApiClientCredential).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(screen.getByRole("dialog", { name: "Rotate API credential" })).toBeInTheDocument();
  await act(async () => resolveRotation({ api_key: "defy_rotated-secret" }));
  await user.click(within(await screen.findByRole("dialog", { name: "Save API credential" })).getByRole("button", { name: "I saved it" }));

  const refreshedClient = await screen.findByRole("group", { name: "API client settlement-worker" });
  await user.click(within(refreshedClient).getByRole("button", { name: "Revoke credential" }));
  const revokeButton = screen.getByRole("button", { name: "Confirm revoke" });
  act(() => {
    clickTwiceBeforeReactFlush(revokeButton);
  });
  expect(revokeApiClientCredential).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("alertdialog", { name: "Revoke API credential?" })).toBeInTheDocument();
  await act(async () => resolveRevoke(true));
  await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "Revoke API credential?" })).not.toBeInTheDocument());
});
