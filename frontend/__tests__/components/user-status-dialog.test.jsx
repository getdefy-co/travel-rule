import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { UserStatusDialog } from "@/components/user-status-dialog";

jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

beforeEach(() => jest.clearAllMocks());

const deferred = () => {
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
  });
  return { promise, reject };
};

test("confirms activation and closes after success", async () => {
  const user = userEvent.setup();
  const onConfirm = jest.fn().mockResolvedValue(undefined);
  const onOpenChange = jest.fn();
  const onSuccess = jest.fn();

  render(
    <UserStatusDialog
      action="activate"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
      open
      user={{ email: "inactive@example.com", active: false }}
    />,
  );

  expect(screen.getByText("inactive@example.com")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Activate user" }));

  expect(onConfirm).toHaveBeenCalledWith("inactive@example.com");
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("keeps a failed deactivation open and prevents same-tick double confirmation", async () => {
  const request = deferred();
  const onConfirm = jest.fn(() => request.promise);
  const onOpenChange = jest.fn();

  render(
    <UserStatusDialog
      action="deactivate"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      onSuccess={jest.fn()}
      open
      user={{ email: "active@example.com", active: true }}
    />,
  );

  const confirm = screen.getByRole("button", { name: "Deactivate user" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);

  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Deactivating user" })).toBeDisabled();

  request.reject(new Error("User changed elsewhere"));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("User changed elsewhere"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Deactivate user" })).toBeInTheDocument();
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});

test("ignores every dismiss request while a status mutation is pending", async () => {
  const user = userEvent.setup();
  let resolveRequest;
  const request = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const onOpenChange = jest.fn();
  const onConfirm = jest.fn(() => request);

  render(
    <UserStatusDialog
      action="deactivate"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      onSuccess={jest.fn()}
      open
      user={{ email: "pending@example.com", active: true }}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Deactivate user" }));
  await user.click(screen.getByRole("button", { name: "Close dialog" }));

  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  expect(screen.getByRole("dialog", { name: "Deactivate user" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Deactivating user" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);

  resolveRequest();
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

test("supports controlled cancellation and renders no dialog without a selected user", async () => {
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  const { rerender } = render(
    <UserStatusDialog
      action="activate"
      onConfirm={jest.fn()}
      onOpenChange={onOpenChange}
      onSuccess={jest.fn()}
      open
      user={{ email: "inactive@example.com", active: false }}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);

  rerender(
    <UserStatusDialog
      action="activate"
      onConfirm={jest.fn()}
      onOpenChange={onOpenChange}
      onSuccess={jest.fn()}
      open
      user={null}
    />,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
