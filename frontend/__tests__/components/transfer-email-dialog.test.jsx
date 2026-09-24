import { toast } from "sonner";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TransferEmailDialog } from "@/components/transfer-email-dialog";
import { createTravelRuleEmailInvitation } from "@/lib/api";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn(), info: jest.fn(), dismiss: jest.fn() } }));

jest.mock("@/lib/api", () => ({ createTravelRuleEmailInvitation: jest.fn() }));

const transferId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  jest.resetAllMocks();
});

test("validates the recipient and prevents same-tick duplicate submissions", async () => {
  let resolveInvitation;
  createTravelRuleEmailInvitation.mockReturnValue(new Promise((resolve) => { resolveInvitation = resolve; }));
  const onComplete = jest.fn();
  const onOpenChange = jest.fn();
  render(<TransferEmailDialog onComplete={onComplete} onOpenChange={onOpenChange} open transferId={transferId} />);

  const form = screen.getByRole("form", { name: "Transfer email invitation" });
  expect(form).toHaveAttribute("novalidate");
  fireEvent.submit(form);
  expect(createTravelRuleEmailInvitation).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("Enter a valid recipient email.");
  expect(screen.getByLabelText("Recipient email")).toHaveFocus();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Recipient email"), { target: { value: " recipient@example.test " } });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(createTravelRuleEmailInvitation).toHaveBeenCalledTimes(1);
  expect(createTravelRuleEmailInvitation).toHaveBeenCalledWith(transferId, "recipient@example.test");
  expect(screen.getByRole("button", { name: "Send email" })).toBeDisabled();

  await act(async () => { resolveInvitation({ id: "job-id" }); });
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(onComplete).toHaveBeenCalledTimes(1);
});

test("shows sanitized failure feedback and permits a new parallel invitation after reopening", async () => {
  const user = userEvent.setup();
  createTravelRuleEmailInvitation.mockRejectedValueOnce(new Error("sensitive provider response")).mockResolvedValueOnce({ id: "second" });
  const onOpenChange = jest.fn();
  const { rerender } = render(<TransferEmailDialog onComplete={jest.fn()} onOpenChange={onOpenChange} open transferId={transferId} />);

  await user.type(screen.getByLabelText("Recipient email"), "first@example.test");
  await user.click(screen.getByRole("button", { name: "Send email" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not create the email invitation."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  rerender(<TransferEmailDialog onComplete={jest.fn()} onOpenChange={onOpenChange} open={false} transferId={transferId} />);
  rerender(<TransferEmailDialog onComplete={jest.fn()} onOpenChange={onOpenChange} open transferId={transferId} />);
  await user.clear(screen.getByLabelText("Recipient email"));
  await user.type(screen.getByLabelText("Recipient email"), "second@example.test");
  await user.click(screen.getByRole("button", { name: "Send email" }));
  await waitFor(() => expect(createTravelRuleEmailInvitation).toHaveBeenCalledTimes(2));
});

test("closes without sending when the recipient cancels", async () => {
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  render(<TransferEmailDialog onComplete={jest.fn()} onOpenChange={onOpenChange} open transferId={transferId} />);

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(createTravelRuleEmailInvitation).not.toHaveBeenCalled();
});


test.each(["resolve", "reject"])("ignores a late %s after unmount and blocks duplicate submit", async (outcome) => {
  let finish;
  createTravelRuleEmailInvitation.mockReturnValueOnce(new Promise((resolve, reject) => { finish = outcome === "resolve" ? resolve : reject; }));
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  const onComplete = jest.fn();
  const { unmount } = render(<TransferEmailDialog open transferId={transferId} onOpenChange={onOpenChange} onComplete={onComplete} />);
  await user.type(screen.getByLabelText("Recipient email"), "recipient@example.test");
  const form = screen.getByRole("form", { name: "Transfer email invitation" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(createTravelRuleEmailInvitation).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => { finish(new Error("late response")); });
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(onComplete).not.toHaveBeenCalled();
});
