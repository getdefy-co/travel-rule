import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { UserFormDialog } from "@/components/user-form-dialog";

jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

beforeEach(() => jest.clearAllMocks());

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

test("validates and trims a new user's email before submitting an exact role", async () => {
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  const onSubmit = jest.fn().mockResolvedValue(undefined);
  const onSuccess = jest.fn();

  render(
    <UserFormDialog
      mode="create"
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      onSuccess={onSuccess}
      open
    />,
  );

  await user.click(screen.getByRole("button", { name: "Create user" }));
  const emailInput = screen.getByRole("textbox", { name: "Email" });
  expect(toast.error).toHaveBeenCalledWith("Email is required.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(emailInput).toHaveAttribute("aria-invalid", "true");
  expect(emailInput).not.toHaveAttribute("aria-describedby");
  expect(emailInput).toHaveFocus();
  expect(onSubmit).not.toHaveBeenCalled();

  await user.type(emailInput, "not-an-email");
  await user.click(screen.getByRole("button", { name: "Create user" }));
  expect(toast.error).toHaveBeenLastCalledWith("Enter a valid email address.");
  await user.clear(screen.getByRole("textbox", { name: "Email" }));
  await user.type(screen.getByRole("textbox", { name: "Email" }), "  person@example.com  ");
  await user.click(screen.getByRole("combobox", { name: "Role" }));
  await user.click(screen.getByRole("option", { name: "Admin" }));
  await user.click(screen.getByRole("button", { name: "Create user" }));

  expect(onSubmit).toHaveBeenCalledWith({ email: "person@example.com", role: "admin" });
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("supports a controlled cancel action and renders no content while closed", async () => {
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  const { rerender } = render(
    <UserFormDialog
      mode="create"
      onOpenChange={onOpenChange}
      onSubmit={jest.fn()}
      onSuccess={jest.fn()}
      open
    />,
  );

  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);

  rerender(
    <UserFormDialog
      mode="create"
      onOpenChange={onOpenChange}
      onSubmit={jest.fn()}
      onSuccess={jest.fn()}
      open={false}
    />,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("locks the email in edit mode and only submits the selected role", async () => {
  const user = userEvent.setup();
  const onSubmit = jest.fn().mockResolvedValue(undefined);

  render(
    <UserFormDialog
      mode="edit"
      onOpenChange={jest.fn()}
      onSubmit={onSubmit}
      onSuccess={jest.fn()}
      open
      user={{ email: "locked@example.com", role: "admin" }}
    />,
  );

  expect(screen.getByRole("textbox", { name: "Email" })).toBeDisabled();
  expect(screen.getByText("Email cannot be changed.")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute(
    "aria-describedby",
    "managed-user-email-locked",
  );
  await user.click(screen.getByRole("combobox", { name: "Role" }));
  await user.click(screen.getByRole("option", { name: "User" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(onSubmit).toHaveBeenCalledWith({ email: "locked@example.com", role: "user" });
});

test("keeps only the locked-email description when validation uses a toast", async () => {
  const user = userEvent.setup();
  render(
    <UserFormDialog
      mode="edit"
      onOpenChange={jest.fn()}
      onSubmit={jest.fn()}
      onSuccess={jest.fn()}
      open
      user={{ email: "", role: "admin" }}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute(
    "aria-describedby",
    "managed-user-email-locked",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(toast.error).toHaveBeenCalledWith("Email is required.");
});

test("keeps a failed mutation open and prevents same-tick double submission", async () => {
  const request = deferred();
  const onOpenChange = jest.fn();
  const onSubmit = jest.fn(() => request.promise);

  render(
    <UserFormDialog
      mode="create"
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      onSuccess={jest.fn()}
      open
    />,
  );

  const email = screen.getByRole("textbox", { name: "Email" });
  fireEvent.change(email, { target: { value: "new@example.com" } });
  const form = screen.getByRole("form", { name: "User form" });
  fireEvent.submit(form);
  fireEvent.submit(form);

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Creating user" })).toBeDisabled();

  request.resolve(Promise.reject(new Error("Email already exists")));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Email already exists"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Create user" })).toBeInTheDocument();
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});

test("ignores every dismiss request while a mutation is pending", async () => {
  const user = userEvent.setup();
  const request = deferred();
  const onOpenChange = jest.fn();
  const onSubmit = jest.fn(() => request.promise);

  render(
    <UserFormDialog
      mode="create"
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      onSuccess={jest.fn()}
      open
    />,
  );

  await user.type(screen.getByRole("textbox", { name: "Email" }), "pending@example.com");
  await user.click(screen.getByRole("button", { name: "Create user" }));
  await user.click(screen.getByRole("button", { name: "Close dialog" }));

  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  expect(screen.getByRole("dialog", { name: "Create user" })).toBeInTheDocument();
  fireEvent.submit(screen.getByRole("form", { name: "User form" }));
  expect(onSubmit).toHaveBeenCalledTimes(1);

  request.resolve();
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});
