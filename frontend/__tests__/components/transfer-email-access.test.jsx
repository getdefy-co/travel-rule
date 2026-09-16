import { toast } from "sonner";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TransferEmailAccess } from "@/components/transfer-email-access";
import { consumeTravelRuleEmailAccess } from "@/lib/api";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn(), info: jest.fn(), dismiss: jest.fn() } }));

jest.mock("@/lib/api", () => ({ consumeTravelRuleEmailAccess: jest.fn() }));

const token = "t".repeat(43);
const summary = {
  beneficiaries: [{ accounts: ["DE123"], addresses: [{ country: "DE", lines: ["Example street 1"], town: "Berlin" }], country: "DE", name: "Example GmbH", type: "legal" }],
  originators: [{ accounts: ["TR123"], addresses: [], country: "TR", name: "Ada Lovelace", type: "natural" }],
  transfer: { amount: "25", asset: { dti: "4H95J0R2X" }, created_at: "2026-09-02T10:00:00.000Z", direction: "outbound", expires_at: null, id: "11111111-1111-4111-8111-111111111111", protocol: "TRP", state: "pending" },
};

beforeEach(() => {
  jest.resetAllMocks();
  window.history.replaceState({}, "", `/travel-rule/shared#token=${token}`);
  consumeTravelRuleEmailAccess.mockResolvedValue(summary);
});

test("keeps the fragment token in memory, consumes only on explicit action, then clears it", async () => {
  const user = userEvent.setup();
  const { unmount } = render(<TransferEmailAccess />);

  expect(await screen.findByRole("button", { name: "View transfer" })).toBeInTheDocument();
  expect(consumeTravelRuleEmailAccess).not.toHaveBeenCalled();
  expect(window.location.hash).toBe(`#token=${token}`);

  await user.click(screen.getByRole("button", { name: "View transfer" }));
  await waitFor(() => expect(consumeTravelRuleEmailAccess).toHaveBeenCalledWith(token));
  expect(window.location.hash).toBe("");
  expect(await screen.findByText("Example GmbH")).toBeInTheDocument();
  expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  expect(screen.getByText("DE123")).toBeInTheDocument();
  expect(screen.getByText("Pending")).toHaveClass("border-amber-500/30", "bg-amber-500/10");
  expect(screen.getByText("Legal person")).toHaveClass("border-slate-500/30", "bg-slate-500/10");

  unmount();
  render(<TransferEmailAccess />);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Link unavailable.", expect.objectContaining({ description: expect.any(String) })));
  expect(screen.queryByText("Link unavailable.")).not.toBeInTheDocument();
  expect(consumeTravelRuleEmailAccess).toHaveBeenCalledTimes(1);
});

test("uses the same generic unavailable state for invalid and consumed tokens", async () => {
  const user = userEvent.setup();
  consumeTravelRuleEmailAccess.mockRejectedValueOnce(Object.assign(new Error("Link unavailable."), { status: 410 }));
  render(<TransferEmailAccess />);
  await user.click(await screen.findByRole("button", { name: "View transfer" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Link unavailable.", expect.objectContaining({ description: expect.any(String) })));
  expect(screen.queryByText("Link unavailable.")).not.toBeInTheDocument();
  expect(screen.queryByText(token)).not.toBeInTheDocument();
});

test("cancels the deferred fragment read when the page unmounts", async () => {
  const { unmount } = render(<TransferEmailAccess />);
  unmount();
  await act(async () => Promise.resolve());

  expect(consumeTravelRuleEmailAccess).not.toHaveBeenCalled();
});


test.each(["resolve", "reject"])("ignores a %s after the shared page closes and consumes only once", async (outcome) => {
  let finish;
  consumeTravelRuleEmailAccess.mockReturnValueOnce(new Promise((resolve, reject) => { finish = outcome === "resolve" ? resolve : reject; }));
  const { unmount } = render(<TransferEmailAccess />);
  const view = await screen.findByRole("button", { name: "View transfer" });
  act(() => { view.click(); view.click(); });
  expect(consumeTravelRuleEmailAccess).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => { finish(new Error("late response")); });
  expect(toast.error).not.toHaveBeenCalled();
});
