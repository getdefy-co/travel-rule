import { toast } from "sonner";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UpdateModal } from "@/components/update-modal";
import { submitUpdateRequest } from "@/lib/api";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn(), info: jest.fn(), dismiss: jest.fn() } }));

jest.mock("@/lib/api", () => ({ submitUpdateRequest: jest.fn() }));

beforeEach(() => jest.resetAllMocks());

test("requests only an email and acknowledges a successful request", async () => {
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  submitUpdateRequest.mockResolvedValue(true);
  render(<UpdateModal open onOpenChange={onOpenChange} />);

  expect(screen.getByRole("dialog", { name: "Project updates" })).toBeInTheDocument();
  expect(screen.getByLabelText("Email")).toHaveValue("");
  await user.type(screen.getByLabelText("Email"), "reader@example.test");
  await user.click(screen.getByRole("button", { name: "Send request" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Your request has been received."));
  expect(submitUpdateRequest).toHaveBeenCalledWith("reader@example.test");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test.each(["", "invalid", "a@b", `${"a".repeat(245)}@example.test`, "first@example.test\nsecond@example.test"])("rejects invalid email %p before calling the API", async (email) => {
  render(<UpdateModal open onOpenChange={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.submit(screen.getByRole("form", { name: "Update request" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Enter a valid email address."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(submitUpdateRequest).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Email")).toHaveFocus();
  expect(screen.getByLabelText("Email")).not.toHaveAttribute("aria-describedby");
});

test("prevents concurrent submissions, keeps errors visible, and permits a manual retry", async () => {
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  let rejectRequest;
  submitUpdateRequest.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
  render(<UpdateModal open onOpenChange={onOpenChange} />);
  await user.type(screen.getByLabelText("Email"), " reader@example.test ");
  fireEvent.submit(screen.getByRole("form", { name: "Update request" }));
  fireEvent.submit(screen.getByRole("form", { name: "Update request" }));
  expect(screen.getByRole("button", { name: "Sending request" })).toBeDisabled();
  expect(submitUpdateRequest).toHaveBeenCalledTimes(1);
  expect(submitUpdateRequest).toHaveBeenCalledWith("reader@example.test");
  await user.keyboard("{Escape}");
  expect(onOpenChange).not.toHaveBeenCalled();
  await act(async () => rejectRequest(new Error("Too many requests. Please try again in 15 minutes.")));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Too many requests. Please try again in 15 minutes."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Email")).toHaveValue("reader@example.test");
  submitUpdateRequest.mockResolvedValueOnce(true);
  await user.click(screen.getByRole("button", { name: "Send request" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("supports dismissing before submission and a generic unexpected error", async () => {
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  submitUpdateRequest.mockRejectedValue(null);
  render(<UpdateModal open onOpenChange={onOpenChange} />);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  await user.type(screen.getByLabelText("Email"), "reader@example.test");
  await user.click(screen.getByRole("button", { name: "Send request" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("We could not send your request. Please try again later."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test.each(["resolve", "reject"])("ignores a %s after the modal unmounts", async (outcome) => {
  let finish;
  submitUpdateRequest.mockReturnValueOnce(new Promise((resolve, reject) => { finish = outcome === "resolve" ? resolve : reject; }));
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  const { unmount } = render(<UpdateModal open onOpenChange={onOpenChange} />);
  await user.type(screen.getByLabelText("Email"), "updates@example.test");
  await user.click(screen.getByRole("button", { name: "Send request" }));
  unmount();
  await act(async () => { finish(new Error("late response")); });
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
});
