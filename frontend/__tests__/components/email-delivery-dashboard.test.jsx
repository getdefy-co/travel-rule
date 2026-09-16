import { toast } from "sonner";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EmailDeliveryDashboard } from "@/components/email-delivery-dashboard";
import { listTravelRuleEmailJobs, retryTravelRuleEmailJob } from "@/lib/api";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn(), info: jest.fn(), dismiss: jest.fn() } }));

jest.mock("@/lib/api", () => ({ listTravelRuleEmailJobs: jest.fn(), retryTravelRuleEmailJob: jest.fn() }));

const job = (overrides = {}) => ({
  attempts: 5,
  consumed_at: null,
  created_at: "2026-09-02T10:00:00.000Z",
  expires_at: "2026-10-02T10:00:00.000Z",
  id: "66666666-6666-4666-8666-666666666666",
  last_error_code: "EMAIL_DELIVERY_FAILED",
  recipient_email: "recipient@example.test",
  sent_at: null,
  status: "dead_lettered",
  transfer_id: "11111111-1111-4111-8111-111111111111",
  updated_at: "2026-09-02T10:05:00.000Z",
  ...overrides,
});

beforeEach(() => {
  jest.resetAllMocks();
  listTravelRuleEmailJobs.mockResolvedValue({ data: [job(), job({ id: "77777777-7777-4777-8777-777777777777", status: "sent", sent_at: "2026-09-02T10:01:00.000Z" })], limit: 20, page: 1, total: 30 });
  retryTravelRuleEmailJob.mockResolvedValue(job({ attempts: 0, status: "queued" }));
});

test("lists delivery lifecycle metadata, filters statuses, paginates, and retries only dead letters", async () => {
  const user = userEvent.setup();
  render(<EmailDeliveryDashboard />);

  expect(await screen.findAllByText("recipient@example.test")).toHaveLength(2);
  expect(screen.getByRole("table", { name: "Travel Rule email deliveries" })).toBeInTheDocument();
  expect(screen.getByText("Dead lettered")).toHaveClass("border-red-500/30", "bg-red-500/10");
  expect(screen.getAllByText("Sent").find((element) => element.getAttribute("data-slot") === "badge")).toHaveClass("border-emerald-500/30", "bg-emerald-500/10");
  expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);

  await user.click(screen.getByRole("combobox", { name: "Delivery status" }));
  await user.click(await screen.findByRole("option", { name: "Sent" }));
  await waitFor(() => expect(listTravelRuleEmailJobs).toHaveBeenLastCalledWith({ limit: 20, page: 1, status: "sent" }));

  await user.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(listTravelRuleEmailJobs).toHaveBeenLastCalledWith({ limit: 20, page: 2, status: "sent" }));
  await user.click(screen.getByRole("button", { name: "Previous page" }));
  await waitFor(() => expect(listTravelRuleEmailJobs).toHaveBeenLastCalledWith({ limit: 20, page: 1, status: "sent" }));

  const deadLetterRow = screen.getByRole("row", { name: /Dead lettered/ });
  await user.click(within(deadLetterRow).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(retryTravelRuleEmailJob).toHaveBeenCalledWith(job().id));
});

test("shows a localized recoverable list error", async () => {
  const user = userEvent.setup();
  listTravelRuleEmailJobs.mockRejectedValueOnce(new Error("raw database detail"));
  render(<EmailDeliveryDashboard />);

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not load email deliveries."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry deliveries" }));
  expect(await screen.findAllByText("recipient@example.test")).toHaveLength(2);
});

test("sanitizes retry failures and restores the retry control", async () => {
  const user = userEvent.setup();
  retryTravelRuleEmailJob.mockRejectedValueOnce(new Error("provider secret"));
  render(<EmailDeliveryDashboard />);

  const retryButton = await screen.findByRole("button", { name: "Retry" });
  await user.click(retryButton);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not retry the email delivery."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(retryButton).toBeEnabled();
});


test.each(["resolve", "reject"])("blocks duplicate retry and ignores a %s after leaving the page", async (outcome) => {
  let finish;
  retryTravelRuleEmailJob.mockReturnValueOnce(new Promise((resolve, reject) => { finish = outcome === "resolve" ? resolve : reject; }));
  const { unmount } = render(<EmailDeliveryDashboard />);
  const retry = await screen.findByRole("button", { name: "Retry" });
  act(() => { retry.click(); retry.click(); });
  expect(retryTravelRuleEmailJob).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => { finish(new Error("late response")); });
  expect(toast.error).not.toHaveBeenCalled();
  expect(listTravelRuleEmailJobs).toHaveBeenCalledTimes(1);
});
