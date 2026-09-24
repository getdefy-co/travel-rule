import { toast } from "sonner";
import { StrictMode } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InquiryDashboard } from "@/components/inquiry-dashboard";
import { listTrpInquiries } from "@/lib/api";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn(), info: jest.fn(), dismiss: jest.fn() } }));

jest.mock("@/lib/api", () => ({ listTrpInquiries: jest.fn() }));
jest.mock("@/components/inquiry-detail-dialog", () => ({
  InquiryDetailDialog: ({ inquiryId, onDecisionComplete, onOpenChange, open }) => open ? (
    <div role="dialog" aria-label="Mock inquiry detail">
      <span>{inquiryId}</span>
      <button type="button" onClick={onDecisionComplete}>Complete decision</button>
      <button type="button" onClick={() => onOpenChange(true)}>Keep details open</button>
      <button type="button" onClick={() => onOpenChange(false)}>Close details</button>
    </div>
  ) : null,
}));

const statuses = ["pending", "approved", "rejected", "confirmed", "canceled", "expired"];
const inquiry = {
  id: "11111111-1111-4111-8111-111111111111",
  state: "pending",
  asset_dti: null,
  amount: null,
  expires_at: null,
  created_at: "2030-01-01T10:00:00.000Z",
  updated_at: "2030-01-01T10:00:00.000Z",
};

const listResponse = (overrides = {}) => ({
  data: [inquiry],
  total: 21,
  page: 1,
  limit: 10,
  ...overrides,
});

const mockSuccessfulLoad = (response = listResponse()) => {
  listTrpInquiries.mockImplementation(({ status, page = 1, limit = 10 }) => {
    if (status && limit === 1) {
      return Promise.resolve({ data: [], total: statuses.indexOf(status) + 1, page: 1, limit: 1 });
    }
    return Promise.resolve({ ...response, page, limit });
  });
};

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSuccessfulLoad();
});

test("loads the review list and six independent status totals", async () => {
  render(<InquiryDashboard />);

  expect(await screen.findByRole("heading", { name: "Inquiry review" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "TRP inquiry review dashboard" })).toBeInTheDocument();
  await waitFor(() => expect(listTrpInquiries).toHaveBeenCalledTimes(7));
  statuses.forEach((status, index) => {
    const card = screen.getByRole("button", { name: new RegExp(`${status} ${index + 1}`, "i") });
    expect(card).toHaveAttribute("aria-pressed", status === "pending" ? "false" : "false");
    expect(listTrpInquiries).toHaveBeenCalledWith({ status, page: 1, limit: 1 });
  });
  const table = screen.getByRole("table", { name: "Inquiry review queue" });
  expect(within(table).getByText("11111111-1111-4111-8111-111111111111")).toBeInTheDocument();
  expect(within(table).getByText("Pending")).toHaveClass("border-amber-500/30", "bg-amber-500/10", "text-amber-700", "dark:text-amber-300");
  expect(within(table).getAllByText("N/A")).toHaveLength(3);
  expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
});

test("searches all inquiries from page one while keeping global status totals", async () => {
  const user = userEvent.setup();
  const match = { ...inquiry, id: "22222222-2222-4222-8222-222222222222" };
  listTrpInquiries.mockImplementation(({ search, limit, page }) => Promise.resolve({
    data: limit === 1 ? [] : search === "outside" ? [match] : [inquiry],
    total: limit === 1 ? 9 : search === "outside" ? 1 : 21, page, limit,
  }));
  render(<InquiryDashboard />);
  await screen.findByText(inquiry.id);
  await user.click(screen.getByRole("button", { name: "Next page" }));
  await user.type(screen.getByRole("textbox", { name: "Search inquiries" }), "outside");
  expect(await screen.findByText(match.id)).toBeInTheDocument();
  await waitFor(() => expect(listTrpInquiries).toHaveBeenLastCalledWith({ status: null, search: "outside", page: 1, limit: 10 }));
  expect(screen.getByRole("button", { name: "Pending 9" })).toBeInTheDocument();
  expect(listTrpInquiries.mock.calls.filter(([options]) => options.limit === 1)).toHaveLength(6);
});

test("uses status cards as filters and resets pagination for filter and page-size changes", async () => {
  const user = userEvent.setup();
  render(<InquiryDashboard />);
  await waitFor(() => expect(listTrpInquiries).toHaveBeenCalledTimes(7));

  await user.click(screen.getByRole("button", { name: /pending 1/i }));
  await waitFor(() => expect(listTrpInquiries).toHaveBeenCalledWith({ status: "pending", page: 1, limit: 10 }));
  expect(screen.getByRole("button", { name: /pending 1/i })).toHaveAttribute("aria-pressed", "true");

  await user.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(listTrpInquiries).toHaveBeenCalledWith({ status: "pending", page: 2, limit: 10 }));
  await user.click(screen.getByRole("button", { name: "Previous page" }));
  await waitFor(() => expect(listTrpInquiries).toHaveBeenLastCalledWith({ status: "pending", page: 1, limit: 10 }));

  const statusTrigger = screen.getByRole("combobox", { name: "Status filter" });
  await user.click(statusTrigger);
  await user.click(screen.getByRole("option", { name: "Rejected" }));
  await waitFor(() => expect(listTrpInquiries).toHaveBeenCalledWith({ status: "rejected", page: 1, limit: 10 }));

  const pageSizeTrigger = screen.getByRole("combobox", { name: "Rows per page" });
  await user.click(pageSizeTrigger);
  await user.click(screen.getByRole("option", { name: "25" }));
  await waitFor(() => expect(listTrpInquiries).toHaveBeenCalledWith({ status: "rejected", page: 1, limit: 25 }));
});

test("refreshes manually, opens details, and refreshes again after a decision", async () => {
  const user = userEvent.setup();
  render(<InquiryDashboard />);
  await waitFor(() => expect(listTrpInquiries).toHaveBeenCalledTimes(7));

  await user.click(screen.getByRole("button", { name: "Refresh inquiries" }));
  await waitFor(() => expect(listTrpInquiries).toHaveBeenCalledTimes(14));

  const reviewButton = screen.getByRole("button", { name: "Review inquiry 11111111-1111-4111-8111-111111111111" });
  expect(reviewButton).toHaveTextContent("Review");
  await user.click(reviewButton);
  expect(screen.getByRole("dialog", { name: "Mock inquiry detail" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Keep details open" }));
  expect(screen.getByRole("dialog", { name: "Mock inquiry detail" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Complete decision" }));
  await waitFor(() => expect(listTrpInquiries).toHaveBeenCalledTimes(21));
  await user.click(screen.getByRole("button", { name: "Close details" }));
  expect(screen.queryByRole("dialog", { name: "Mock inquiry detail" })).not.toBeInTheDocument();
});

test("keeps the queue usable when one or more status totals fail", async () => {
  listTrpInquiries.mockImplementation(({ status, limit }) => {
    if (["approved", "rejected"].includes(status) && limit === 1) {
      return Promise.reject(new Error("count unavailable"));
    }
    if (status && limit === 1) {
      return Promise.resolve({ data: [], total: 2, page: 1, limit: 1 });
    }
    return Promise.resolve(listResponse());
  });
  render(<InquiryDashboard />);

  expect(await screen.findByText("11111111-1111-4111-8111-111111111111")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /approved unavailable/i })).toBeInTheDocument();
  expect(toast.warning).toHaveBeenCalledTimes(1);
  expect(toast.warning).toHaveBeenCalledWith("Some status totals are unavailable.");
  expect(screen.queryByText("Some status totals are unavailable.")).not.toBeInTheDocument();
});

test("renders list error and empty states with a retry action", async () => {
  listTrpInquiries.mockImplementation(({ status, limit }) => {
    if (status && limit === 1) {
      return Promise.resolve({ data: [], total: 0, page: 1, limit: 1 });
    }
    return Promise.reject(new Error("queue offline"));
  });
  const user = userEvent.setup();
  render(<InquiryDashboard />);

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not load the inquiry queue."));
  expect(screen.queryByText("Could not load the inquiry queue.")).not.toBeInTheDocument();
  mockSuccessfulLoad(listResponse({ data: [], total: 0 }));
  await user.click(screen.getByRole("button", { name: "Retry inquiries" }));
  expect(await screen.findByText("No inquiries match this filter.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
});

test("ignores stale list results after a filter changes", async () => {
  const initial = deferred();
  listTrpInquiries.mockImplementation(({ status, limit }) => {
    if (status && limit === 1) {
      return Promise.resolve({ data: [], total: 0, page: 1, limit: 1 });
    }
    if (!status) {
      return initial.promise;
    }
    return Promise.resolve(listResponse({
      data: [{ ...inquiry, id: "22222222-2222-4222-8222-222222222222", state: status }],
      total: 1,
    }));
  });
  const user = userEvent.setup();
  render(<InquiryDashboard />);

  await user.click(await screen.findByRole("button", { name: /pending 0/i }));
  expect(await screen.findByText("22222222-2222-4222-8222-222222222222")).toBeInTheDocument();
  initial.resolve(listResponse());
  await waitFor(() => expect(screen.queryByText("11111111-1111-4111-8111-111111111111")).not.toBeInTheDocument());
});

test("ignores stale status totals after a manual refresh", async () => {
  const oldPendingCount = deferred();
  let pendingCalls = 0;
  listTrpInquiries.mockImplementation(({ status, limit }) => {
    if (status === "pending" && limit === 1) {
      pendingCalls += 1;
      return pendingCalls === 1
        ? oldPendingCount.promise
        : Promise.resolve({ data: [], total: 5, page: 1, limit: 1 });
    }
    if (status && limit === 1) {
      return Promise.resolve({ data: [], total: 1, page: 1, limit: 1 });
    }
    return Promise.resolve(listResponse());
  });
  const user = userEvent.setup();
  render(<InquiryDashboard />);

  await screen.findByText("11111111-1111-4111-8111-111111111111");
  await user.click(screen.getByRole("button", { name: "Refresh inquiries" }));
  expect(await screen.findByRole("button", { name: /pending 5/i })).toBeInTheDocument();
  oldPendingCount.resolve({ data: [], total: 99, page: 1, limit: 1 });
  await waitFor(() => expect(screen.queryByRole("button", { name: /pending 99/i })).not.toBeInTheDocument());
});


test("places one icon refresh beside the filters and removes the queue card heading", async () => {
  render(<InquiryDashboard />);
  await screen.findByText(inquiry.id);
  const toolbar = screen.getByRole("group", { name: "Inquiry filters" });
  expect(within(toolbar).getByRole("textbox", { name: "Search inquiries" })).toBeInTheDocument();
  expect(within(toolbar).getByRole("combobox", { name: "Status filter" })).toBeInTheDocument();
  expect(within(toolbar).getByRole("combobox", { name: "Rows per page" })).toHaveTextContent("10");
  expect(within(toolbar).getByRole("button", { name: "Refresh inquiries" })).toHaveTextContent(/^$/);
  expect(screen.getAllByRole("button", { name: "Refresh inquiries" })).toHaveLength(1);
  expect(screen.queryByText("Review queue")).not.toBeInTheDocument();
  expect(screen.queryByText("Filter, inspect, and decide inbound inquiries.")).not.toBeInTheDocument();
});

test("emits one warning and one error in Strict Mode and stays silent after unmount", async () => {
  listTrpInquiries.mockRejectedValue(new Error("unavailable"));
  const { unmount: unmountFirst } = render(<StrictMode><InquiryDashboard /></StrictMode>);
  await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
  expect(toast.warning).toHaveBeenCalledTimes(1);
  unmountFirst();
  jest.clearAllMocks();
  let reject;
  listTrpInquiries.mockReturnValue(new Promise((resolve, rejectPromise) => { reject = rejectPromise; }));
  const { unmount: unmountSecond } = render(<InquiryDashboard />);
  await waitFor(() => expect(listTrpInquiries).toHaveBeenCalledTimes(7));
  unmountSecond();
  await act(async () => { reject(new Error("late failure")); });
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.warning).not.toHaveBeenCalled();
});

test("refresh keeps the chosen filters and refreshes all global totals", async () => {
  const user = userEvent.setup();
  render(<InquiryDashboard />);
  await user.click(await screen.findByRole("button", { name: "Pending 1" }));
  await user.type(screen.getByRole("textbox", { name: "Search inquiries" }), "asset");
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh inquiries" })).toBeEnabled());
  listTrpInquiries.mockClear();
  await user.click(screen.getByRole("button", { name: "Refresh inquiries" }));
  await waitFor(() => expect(listTrpInquiries).toHaveBeenCalledTimes(7));
  expect(listTrpInquiries).toHaveBeenLastCalledWith({ search: "asset", status: "pending", page: 1, limit: 10 });
});

test("keeps the queue usable when clicking the already selected status", async () => {
  const user = userEvent.setup();
  render(<InquiryDashboard />);
  const pending = await screen.findByRole("button", { name: "Pending 1" });
  await user.click(pending);
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh inquiries" })).toBeEnabled());
  listTrpInquiries.mockClear();
  await user.click(pending);
  expect(listTrpInquiries).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Refresh inquiries" })).toBeEnabled();
  expect(screen.getByText(inquiry.id)).toBeInTheDocument();
});
