import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { ChangePasswordModal } from "@/components/change-password-modal";
import { changePassword } from "@/lib/api";

jest.mock("@/lib/api", () => ({ changePassword: jest.fn() }));

beforeEach(() => {
  jest.spyOn(toast, "error").mockImplementation(() => {});
  jest.spyOn(toast, "success").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const fillPasswords = async (user, current, next, confirmation) => {
  await user.type(screen.getByLabelText("Current Password"), current);
  await user.type(screen.getByLabelText("New Password"), next);
  await user.type(screen.getByLabelText("Confirm New Password"), confirmation);
};

const clickTwiceBeforeReactFlush = (control) => {
  fireEvent.click(control);
  fireEvent.click(control);
};

test("validates every password constraint", async () => {
  const user = userEvent.setup();
  render(<ChangePasswordModal open onOpenChange={jest.fn()} />);
  expect(screen.getByLabelText("Current Password")).toHaveAttribute("autocomplete", "current-password");
  expect(screen.getByLabelText("New Password")).toHaveAttribute("autocomplete", "new-password");
  expect(screen.getByLabelText("Confirm New Password")).toHaveAttribute("autocomplete", "new-password");
  fireEvent.submit(screen.getByRole("button", { name: "Change Password" }));
  expect(toast.error).toHaveBeenCalledWith("3 fields need attention. Current Password: Please fill in all password fields.");
  expect(screen.getByLabelText("Current Password")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("New Password")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Confirm New Password")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Current Password")).toHaveFocus();

  await fillPasswords(user, "old-password", "short", "short");
  await user.click(screen.getByRole("button", { name: "Change Password" }));
  expect(toast.error).toHaveBeenCalledWith("Password too short", expect.any(Object));

  for (const input of [screen.getByLabelText("Current Password"), screen.getByLabelText("New Password"), screen.getByLabelText("Confirm New Password")]) await user.clear(input);
  await fillPasswords(user, "old-password", "new-password", "different-password");
  await user.click(screen.getByRole("button", { name: "Change Password" }));
  expect(toast.error).toHaveBeenCalledWith("Passwords do not match", expect.any(Object));

  await user.clear(screen.getByLabelText("Confirm New Password"));
  await user.type(screen.getByLabelText("Confirm New Password"), "new-password");
  await user.clear(screen.getByLabelText("Current Password"));
  await user.type(screen.getByLabelText("Current Password"), "new-password");
  await user.click(screen.getByRole("button", { name: "Change Password" }));
  expect(toast.error).toHaveBeenCalledWith("Same password", expect.any(Object));
  expect(screen.getByLabelText("Current Password")).toHaveAttribute("aria-invalid", "false");
  expect(screen.getByLabelText("New Password")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("New Password")).toHaveFocus();
});

test("toggles visibility, submits, resets and closes on success", async () => {
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  changePassword.mockResolvedValue({});
  render(<ChangePasswordModal open onOpenChange={onOpenChange} />);
  const inputs = [screen.getByLabelText("Current Password"), screen.getByLabelText("New Password"), screen.getByLabelText("Confirm New Password")];
  const visibilityControls = [
    ["Show Current Password", "Hide Current Password"],
    ["Show New Password", "Hide New Password"],
    ["Show Confirm New Password", "Hide Confirm New Password"],
  ];
  for (let index = 0; index < visibilityControls.length; index += 1) {
    const [showLabel, hideLabel] = visibilityControls[index];
    const iconButton = screen.getByRole("button", { name: showLabel });
    expect(iconButton).toHaveAttribute("aria-pressed", "false");
    await user.click(iconButton);
    expect(inputs[index]).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: hideLabel })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: hideLabel }));
    expect(inputs[index]).toHaveAttribute("type", "password");
  }
  await fillPasswords(user, "old-password", "new-password", "new-password");
  await user.click(screen.getByRole("button", { name: "Change Password" }));
  await waitFor(() => expect(changePassword).toHaveBeenCalledWith("old-password", "new-password"));
  expect(toast.success).toHaveBeenCalledWith("Password changed successfully");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("reports and focuses the only missing password field", async () => {
  const user = userEvent.setup();
  render(<ChangePasswordModal open onOpenChange={jest.fn()} />);
  await user.type(screen.getByLabelText("Current Password"), "old-password");
  await user.type(screen.getByLabelText("New Password"), "new-password");

  await user.click(screen.getByRole("button", { name: "Change Password" }));

  expect(toast.error).toHaveBeenCalledWith("Missing fields", { description: "Please fill in all password fields." });
  expect(screen.getByLabelText("Confirm New Password")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Confirm New Password")).toHaveFocus();
});

test("reports API errors and supports cancel", async () => {
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  changePassword.mockRejectedValue(new Error("Denied"));
  render(<ChangePasswordModal open onOpenChange={onOpenChange} />);
  await fillPasswords(user, "old-password", "new-password", "new-password");
  await user.click(screen.getByRole("button", { name: "Change Password" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Error", { description: "Denied" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("prevents dismissal and duplicate submission while a request is pending", async () => {
  const user = userEvent.setup();
  let resolveRequest;
  const request = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const onOpenChange = jest.fn();
  changePassword.mockReturnValueOnce(request);
  render(<ChangePasswordModal open onOpenChange={onOpenChange} />);
  await fillPasswords(user, "old-password", "new-password", "new-password");
  const submit = screen.getByRole("button", { name: "Change Password" });

  act(() => {
    clickTwiceBeforeReactFlush(submit);
  });
  await user.click(screen.getByRole("button", { name: "Close dialog" }));

  expect(changePassword).toHaveBeenCalledTimes(1);
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  expect(screen.getByRole("dialog", { name: "Change Password" })).toBeInTheDocument();
  resolveRequest();
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

test.each(["resolve", "reject"])("ignores a stale password-change %s after unmount", async (outcome) => {
  const user = userEvent.setup();
  let settleRequest;
  changePassword.mockReturnValueOnce(new Promise((resolve, reject) => {
    settleRequest = outcome === "resolve" ? resolve : reject;
  }));
  const onOpenChange = jest.fn();
  const { unmount } = render(<ChangePasswordModal open onOpenChange={onOpenChange} />);
  await fillPasswords(user, "old-password", "new-password", "new-password");
  await user.click(screen.getByRole("button", { name: "Change Password" }));
  unmount();
  toast.error.mockClear();
  toast.success.mockClear();

  await act(async () => settleRequest(outcome === "resolve" ? {} : new Error("Denied")));

  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
});
