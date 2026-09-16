import { toast } from "sonner";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TravelRuleDashboard } from "@/components/travel-rule-dashboard";
import { getTrpAnalytics } from "@/lib/api";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn(), info: jest.fn(), dismiss: jest.fn() } }));

jest.mock("@/lib/api", () => ({ getTrpAnalytics: jest.fn() }));
jest.mock("recharts", () => {
  const component = (name) => function MockChart({ accessibilityLayer, children, data }) {
    return <div data-testid={name} data-accessibility-layer={String(accessibilityLayer)} data-points={data?.length}>{children}</div>;
  };
  return {
    Area: () => null,
    AreaChart: component("activity-chart"),
    Bar: ({ dataKey }) => <span data-testid={`bar-${dataKey}`}>{dataKey}</span>,
    BarChart: component("bar-chart"),
    CartesianGrid: () => null,
    Legend: () => null,
    ResponsiveContainer: ({ children }) => children,
    XAxis: () => null,
    YAxis: ({ tickFormatter }) => tickFormatter ? <span>{tickFormatter(50)}</span> : null,
    Tooltip: () => null,
  };
});

const analytics = {
  asset_amounts: [],
  message_states: [
    { phase: "inquiry", delivery_state: "delivered", count: 3 },
    { phase: "inquiry", delivery_state: "pending", count: 1 },
    { phase: "resolution", delivery_state: "failed", count: 2 },
  ],
  range_days: 30,
  summary: { transfers: 8, pending_inquiries: 1, confirmed_rate: 0.625, delivery_rate: 0.5 },
  transfer_states: [{ state: "pending", count: 2 }, { state: "confirmed", count: 5 }, { state: "rejected", count: 1 }],
  trends: [
    { day: "2026-08-24", direction: "inbound", count: 2 },
    { day: "2026-08-24", direction: "outbound", count: 1 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  getTrpAnalytics.mockResolvedValue(analytics);
});

test("renders live KPI values and four accessible analytics panels without a table", async () => {
  render(<TravelRuleDashboard />);

  expect(await screen.findByRole("heading", { name: "Travel Rule Overview" })).toBeInTheDocument();
  expect(screen.getByText("8")).toBeInTheDocument();
  expect(screen.getByText("1", { selector: "[data-slot='card-title']" })).toBeInTheDocument();
  expect(screen.getByText("62.5%", { selector: "[data-slot='card-title']" })).toBeInTheDocument();
  expect(screen.getAllByText("2", { selector: "[data-slot='card-title']" })).toHaveLength(1);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getAllByTestId("bar-chart")).toHaveLength(2);
  ["activity", "state", "delivery"].map((chart) => screen.getByTestId(`${chart}-chart-container`)).forEach((chart) => {
    expect(chart).toHaveClass("h-64", "w-full");
    expect(chart).not.toHaveClass("min-h-64");
  });
  expect(screen.getByTestId("analytics-chart-grid")).toHaveClass("grid-cols-1");
  for (const chart of [screen.getByTestId("activity-chart"), ...screen.getAllByTestId("bar-chart")]) {
    expect(chart).toHaveAttribute("data-accessibility-layer", "true");
  }
  expect(screen.getByRole("progressbar", { name: "Delivery rate 50%" })).toBeInTheDocument();
});

test("reloads analytics when the range toggle changes", async () => {
  const user = userEvent.setup();
  render(<TravelRuleDashboard />);
  await screen.findByText("Travel Rule Overview");

  const range = screen.getByRole("radiogroup", { name: "Analytics range" });
  await user.click(within(range).getByRole("radio", { name: "7D" }));
  await waitFor(() => expect(getTrpAnalytics).toHaveBeenLastCalledWith("7d"));
});

test("includes received inbound messages in the delivery-state chart", async () => {
  getTrpAnalytics.mockResolvedValueOnce({
    ...analytics,
    message_states: [...analytics.message_states, { phase: "inquiry", delivery_state: "received", count: 2 }],
  });
  render(<TravelRuleDashboard />);

  await screen.findByRole("heading", { name: "Travel Rule Overview" });
  expect(screen.getByTestId("bar-received")).toBeInTheDocument();
});

test("shows loading, failure retry, and empty chart states", async () => {
  let resolveRequest;
  getTrpAnalytics.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
  const user = userEvent.setup();
  const { rerender } = render(<TravelRuleDashboard />);
  expect(screen.getByRole("status", { name: "Loading Travel Rule analytics" })).toBeInTheDocument();
  resolveRequest(analytics);
  await screen.findByText("Travel Rule Overview");

  getTrpAnalytics.mockRejectedValueOnce(new Error("offline"));
  rerender(<TravelRuleDashboard key="error" />);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not load Travel Rule analytics."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  getTrpAnalytics.mockResolvedValueOnce({ ...analytics, trends: [], transfer_states: [], message_states: [] });
  await user.click(screen.getByRole("button", { name: "Retry analytics" }));
  expect(await screen.findAllByText("No analytics data for this range.")).toHaveLength(3);
});
