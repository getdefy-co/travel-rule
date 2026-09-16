import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { UserManagement } from "@/components/user-management";
import { useAuth } from "@/contexts/AuthContext";
import {
  activateManagedUser,
  createManagedUser,
  deactivateManagedUser,
  editManagedUser,
  listManagedUsers,
} from "@/lib/api";

jest.mock("@/contexts/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
jest.mock("@/lib/api", () => ({
  activateManagedUser: jest.fn(),
  createManagedUser: jest.fn(),
  deactivateManagedUser: jest.fn(),
  editManagedUser: jest.fn(),
  listManagedUsers: jest.fn(),
}));

const users = [
  { email: "admin@example.com", role: "admin", active: true, created_at: "2030-01-01T10:00:00.000Z" },
  { email: "active@example.com", role: "user", active: true, created_at: "2030-01-02T10:00:00.000Z" },
  { email: "inactive@example.com", role: "user", active: false, created_at: "invalid-date" },
];

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ user: { email: "admin@example.com", role: "admin" } });
  listManagedUsers.mockResolvedValue({ data: users, pageCount: 3 });
  activateManagedUser.mockResolvedValue(undefined);
  createManagedUser.mockResolvedValue(undefined);
  deactivateManagedUser.mockResolvedValue(undefined);
  editManagedUser.mockResolvedValue(undefined);
});

test("renders loading, exact table columns, account status, and self-protection", async () => {
  const request = deferred();
  listManagedUsers.mockReturnValueOnce(request.promise);
  render(<UserManagement />);

  expect(screen.getByLabelText("Loading users")).toBeInTheDocument();
  request.resolve({ data: users, pageCount: 3 });

  const table = await screen.findByRole("table", { name: "Managed users" });
  await within(table).findByText("admin@example.com");
  ["Email", "Role", "Status", "Created", "Actions"].forEach((column) => {
    expect(within(table).getByRole("columnheader", { name: column })).toBeInTheDocument();
  });
  const ownRow = within(table).getByRole("row", { name: /admin@example\.com/i });
  expect(within(ownRow).getByText("Current account")).toHaveClass("border-blue-500/30", "bg-blue-500/10");
  expect(within(ownRow).getByText("Admin")).toHaveClass("border-violet-500/30", "bg-violet-500/10");
  expect(within(ownRow).getByText("Active")).toHaveClass("border-emerald-500/30", "bg-emerald-500/10");
  expect(within(ownRow).getByRole("button", { name: "Edit admin@example.com" })).toBeDisabled();
  expect(within(ownRow).getByRole("button", { name: "Deactivate admin@example.com" })).toBeDisabled();
  expect(within(table).getByText("Inactive")).toHaveClass("border-slate-500/30", "bg-slate-500/10");
});

test("debounces search by exactly 400 ms and resets pagination", async () => {
  jest.useFakeTimers();
  render(<UserManagement />);
  await act(async () => Promise.resolve());
  await act(async () => Promise.resolve());

  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await act(async () => Promise.resolve());
  expect(listManagedUsers).toHaveBeenLastCalledWith({ page: 2, limit: 10, search: "" });
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  await act(async () => Promise.resolve());
  expect(listManagedUsers).toHaveBeenLastCalledWith({ page: 1, limit: 10, search: "" });

  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await act(async () => Promise.resolve());

  fireEvent.change(screen.getByRole("searchbox", { name: "Search users" }), { target: { value: "  alice  " } });
  act(() => jest.advanceTimersByTime(399));
  expect(listManagedUsers).not.toHaveBeenCalledWith({ page: 1, limit: 10, search: "alice" });
  act(() => jest.advanceTimersByTime(1));
  await act(async () => Promise.resolve());
  expect(listManagedUsers).toHaveBeenLastCalledWith({ page: 1, limit: 10, search: "alice" });

  jest.useRealTimers();
});

test("does not reset pagination when the initial empty search debounce settles", async () => {
  jest.useFakeTimers();
  try {
    render(<UserManagement />);
    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await act(async () => Promise.resolve());
    expect(listManagedUsers).toHaveBeenLastCalledWith({ page: 2, limit: 10, search: "" });
    listManagedUsers.mockClear();

    act(() => jest.advanceTimersByTime(400));
    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());

    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(listManagedUsers).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test("changes page size, refreshes manually, and ignores stale list responses", async () => {
  const user = userEvent.setup();
  const firstRequest = deferred();
  listManagedUsers.mockReturnValueOnce(firstRequest.promise);
  render(<UserManagement />);

  fireEvent.change(screen.getByRole("searchbox", { name: "Search users" }), { target: { value: "new" } });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 410));
  });
  expect(await screen.findByText("admin@example.com")).toBeInTheDocument();
  firstRequest.resolve({
    data: [{ ...users[0], email: "stale@example.com" }],
    pageCount: 1,
  });
  await waitFor(() => expect(screen.queryByText("stale@example.com")).not.toBeInTheDocument());

  await user.click(screen.getByRole("combobox", { name: "Rows per page" }));
  await user.click(screen.getByRole("option", { name: "25" }));
  await waitFor(() => expect(listManagedUsers).toHaveBeenLastCalledWith({ page: 1, limit: 25, search: "new" }));

  const callsBeforeRefresh = listManagedUsers.mock.calls.length;
  await user.click(screen.getByRole("button", { name: "Refresh users" }));
  await waitFor(() => expect(listManagedUsers).toHaveBeenCalledTimes(callsBeforeRefresh + 1));
});

test("shows list error and empty states without removing list controls", async () => {
  const user = userEvent.setup();
  listManagedUsers.mockRejectedValueOnce(new Error("offline"));
  render(<UserManagement />);

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not load users."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("searchbox", { name: "Search users" })).toBeInTheDocument();
  listManagedUsers.mockResolvedValue({ data: [], pageCount: 0 });
  await user.click(screen.getByRole("button", { name: "Retry users" }));
  expect(await screen.findByText("No users match your search.")).toBeInTheDocument();
});

test("creates and edits users, refreshing only after successful mutations", async () => {
  const user = userEvent.setup();
  render(<UserManagement />);
  await screen.findByText("active@example.com");

  await user.click(screen.getByRole("button", { name: "New user" }));
  await user.type(screen.getByRole("textbox", { name: "Email" }), "  created@example.com  ");
  const beforeCreate = listManagedUsers.mock.calls.length;
  await user.click(screen.getByRole("button", { name: "Create user" }));
  expect(createManagedUser).toHaveBeenCalledWith({ email: "created@example.com", role: "user" });
  await waitFor(() => expect(listManagedUsers.mock.calls.length).toBeGreaterThan(beforeCreate));
  expect(screen.queryByRole("dialog", { name: "Create user" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Edit active@example.com" }));
  await user.click(screen.getByRole("combobox", { name: "Role" }));
  await user.click(screen.getByRole("option", { name: "Admin" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(editManagedUser).toHaveBeenCalledWith({ email: "active@example.com", role: "admin" });
});

test("returns to page one after a successful mutation from a later page", async () => {
  const user = userEvent.setup();
  render(<UserManagement />);
  await screen.findByText("active@example.com");
  await user.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(listManagedUsers).toHaveBeenLastCalledWith({ page: 2, limit: 10, search: "" }));
  listManagedUsers.mockClear();

  await user.click(screen.getByRole("button", { name: "New user" }));
  await user.type(screen.getByRole("textbox", { name: "Email" }), "page-two@example.com");
  await user.click(screen.getByRole("button", { name: "Create user" }));

  await waitFor(() => expect(listManagedUsers).toHaveBeenCalledWith({ page: 1, limit: 10, search: "" }));
  expect(listManagedUsers).toHaveBeenCalledTimes(1);
});

test("runs deactivate and activate confirmations while keeping failed mutations open", async () => {
  const user = userEvent.setup();
  deactivateManagedUser
    .mockRejectedValueOnce(new Error("Cannot deactivate now"))
    .mockResolvedValueOnce(undefined);
  render(<UserManagement />);
  await screen.findByText("active@example.com");

  await user.click(screen.getByRole("button", { name: "Deactivate active@example.com" }));
  await user.click(screen.getByRole("button", { name: "Deactivate user" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Cannot deactivate now"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Deactivate user" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Deactivate user" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Deactivate user" })).not.toBeInTheDocument());
  expect(deactivateManagedUser).toHaveBeenCalledWith("active@example.com");

  await user.click(screen.getByRole("button", { name: "Activate inactive@example.com" }));
  await user.click(screen.getByRole("button", { name: "Activate user" }));
  expect(activateManagedUser).toHaveBeenCalledWith("inactive@example.com");
});
