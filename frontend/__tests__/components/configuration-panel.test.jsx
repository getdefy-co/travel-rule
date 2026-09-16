import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ConfigurationPanel } from "@/components/configuration-panel";
import { getServiceApiKey, revealServiceApiKey, rotateServiceApiKey } from "@/lib/api";
import { toast } from "sonner";

jest.mock("@/lib/api", () => ({ getServiceApiKey: jest.fn(), revealServiceApiKey: jest.fn(), rotateServiceApiKey: jest.fn() }));
jest.mock("sonner", () => ({ toast: { dismiss: jest.fn(), error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock("@/components/runtime-configuration-overview", () => ({ RuntimeConfigurationOverview: () => <section><h2>Runtime Overview</h2></section> }));
jest.mock("@/components/api-client-management", () => ({ ApiClientManagement: () => <section><h2>Scoped API Clients</h2></section> }));

const setItemSpy = jest.spyOn(Storage.prototype, "setItem");

const clickTwiceBeforeReactFlush = (control) => {
  fireEvent.click(control);
  fireEvent.click(control);
};

beforeEach(() => {
  jest.clearAllMocks();
  setItemSpy.mockClear();
  getServiceApiKey.mockResolvedValue({ configured: true, masked: "abcd••••wxyz", updated_at: "2026-08-26T00:00:00.000Z" });
  revealServiceApiKey.mockResolvedValue({ api_key: "a".repeat(32), updated_at: "2026-08-26T00:00:00.000Z" });
  rotateServiceApiKey.mockResolvedValue({ configured: true, masked: "new••••key", updated_at: "2026-08-26T01:00:00.000Z" });
});

test("keeps the API key masked until explicit reveal and never persists the revealed secret", async () => {
  const user = userEvent.setup();
  const clipboardSpy = jest.spyOn(navigator.clipboard, "writeText");
  render(<ConfigurationPanel />);
  expect(await screen.findByRole("heading", { name: "Configuration" })).toBeInTheDocument();
  expect(screen.getByText("Admin only")).toHaveClass("border-violet-500/30", "bg-violet-500/10");
  const runtime = screen.getByRole("heading", { name: "Runtime Overview" });
  const clients = screen.getByRole("heading", { name: "Scoped API Clients" });
  const legacy = screen.getByText("Legacy Service API Key");
  expect(runtime.compareDocumentPosition(clients) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(clients.compareDocumentPosition(legacy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("Legacy compatibility only", {
    description: "Use scoped API clients for new integrations. Rotating this key immediately invalidates the previous legacy credential.",
    duration: Infinity,
    id: "configuration-legacy-key-warning",
  }));
  expect(screen.queryByText("Legacy compatibility only")).not.toBeInTheDocument();
  expect(await screen.findByDisplayValue("abcd••••wxyz")).toHaveAttribute("readonly");
  expect(screen.queryByDisplayValue("a".repeat(32))).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Reveal" }));
  expect(await screen.findByDisplayValue("a".repeat(32))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Copy" }));
  expect(clipboardSpy).toHaveBeenCalledWith("a".repeat(32));
  expect(toast.success).toHaveBeenCalledWith("Copied to clipboard.");
  expect(setItemSpy).not.toHaveBeenCalled();
});

test("validates rotation and requires an AlertDialog confirmation", async () => {
  const user = userEvent.setup();
  render(<ConfigurationPanel />);
  await screen.findByDisplayValue("abcd••••wxyz");
  const input = screen.getByLabelText("New API key");
  expect(input).toHaveAttribute("placeholder", "Enter a 32–256 character service API key");
  await user.type(input, "short");
  await user.click(screen.getByRole("button", { name: "Rotate key" }));
  expect(toast.error).toHaveBeenCalledWith("Use 32–256 printable non-whitespace ASCII characters.");
  expect(input).toHaveFocus();
  expect(screen.queryByText("Use 32–256 printable non-whitespace ASCII characters.", { selector: "[role='alert']" })).not.toBeInTheDocument();
  await user.clear(input);
  await user.type(input, "b".repeat(32));
  await user.click(screen.getByRole("button", { name: "Rotate key" }));
  expect(screen.getByRole("alertdialog", { name: "Rotate legacy service API key?" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Confirm rotation" }));
  await waitFor(() => expect(rotateServiceApiKey).toHaveBeenCalledWith("b".repeat(32)));
});

test("recovers from load failures and reports reveal, copy, and rotation failures", async () => {
  const user = userEvent.setup();
  const clipboardSpy = jest.spyOn(navigator.clipboard, "writeText");
  getServiceApiKey.mockRejectedValueOnce(new Error("load failed"));
  render(<ConfigurationPanel />);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not load service API key configuration."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry legacy key" }));
  expect(await screen.findByDisplayValue("abcd••••wxyz")).toBeInTheDocument();

  revealServiceApiKey.mockRejectedValueOnce(new Error("reveal failed"));
  await user.click(screen.getByRole("button", { name: "Reveal" }));
  expect(toast.error).toHaveBeenCalledWith("reveal failed");
  await user.click(screen.getByRole("button", { name: "Reveal" }));
  await screen.findByDisplayValue("a".repeat(32));
  clipboardSpy.mockRejectedValueOnce(new Error("denied"));
  await user.click(screen.getByRole("button", { name: "Copy" }));
  expect(toast.error).toHaveBeenCalledWith("Could not copy to clipboard.");

  rotateServiceApiKey.mockRejectedValueOnce(new Error("rotate failed"));
  const input = screen.getByLabelText("New API key");
  await user.type(input, "c".repeat(32));
  await user.click(screen.getByRole("button", { name: "Rotate key" }));
  await user.click(screen.getByRole("button", { name: "Confirm rotation" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("rotate failed"));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(input).toHaveValue("");
});

test("dismisses persistent warnings and ignores a clipboard failure after unmount", async () => {
  const user = userEvent.setup();
  let rejectCopy;
  const pendingCopy = new Promise((_resolve, reject) => {
    rejectCopy = reject;
  });
  const clipboardSpy = jest.spyOn(navigator.clipboard, "writeText").mockReturnValueOnce(pendingCopy);
  const { unmount } = render(<ConfigurationPanel />);
  await screen.findByDisplayValue("abcd••••wxyz");
  await user.type(screen.getByLabelText("New API key"), "b".repeat(32));
  expect(toast.warning).toHaveBeenCalledWith("Existing legacy clients will stop authenticating", {
    description: "Coordinate the new key with legacy clients immediately after rotation.",
    duration: Infinity,
    id: "configuration-rotation-warning",
  });
  await user.click(screen.getByRole("button", { name: "Reveal" }));
  await user.click(screen.getByRole("button", { name: "Copy" }));
  expect(clipboardSpy).toHaveBeenCalled();
  toast.error.mockClear();

  unmount();
  await act(async () => rejectCopy(new Error("denied")));

  expect(toast.dismiss).toHaveBeenCalledWith("configuration-legacy-key-warning");
  expect(toast.dismiss).toHaveBeenCalledWith("configuration-rotation-warning");
  expect(toast.error).not.toHaveBeenCalled();
});

test("deduplicates reveal and rotation requests while each operation is pending", async () => {
  const user = userEvent.setup();
  let resolveReveal;
  let resolveRotation;
  revealServiceApiKey.mockReturnValueOnce(new Promise((resolve) => {
    resolveReveal = resolve;
  }));
  rotateServiceApiKey.mockReturnValueOnce(new Promise((resolve) => {
    resolveRotation = resolve;
  }));
  render(<ConfigurationPanel />);
  await screen.findByDisplayValue("abcd••••wxyz");

  const revealButton = screen.getByRole("button", { name: "Reveal" });
  act(() => {
    clickTwiceBeforeReactFlush(revealButton);
  });
  expect(revealServiceApiKey).toHaveBeenCalledTimes(1);
  await act(async () => resolveReveal({ api_key: "a".repeat(32) }));

  await user.type(screen.getByLabelText("New API key"), "b".repeat(32));
  await user.click(screen.getByRole("button", { name: "Rotate key" }));
  const confirmButton = screen.getByRole("button", { name: "Confirm rotation" });
  act(() => {
    clickTwiceBeforeReactFlush(confirmButton);
  });
  expect(rotateServiceApiKey).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("alertdialog", { name: "Rotate legacy service API key?" })).toBeInTheDocument();
  await act(async () => resolveRotation({ configured: true, masked: "new••••key", updated_at: "2026-08-26T01:00:00.000Z" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "Rotate legacy service API key?" })).not.toBeInTheDocument());
});
