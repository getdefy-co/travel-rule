import { render, screen } from "@testing-library/react";
import { Circle } from "lucide-react";
import { ChartContainer, ChartLegendContent, ChartStyle, ChartTooltipContent } from "@/components/ui/chart";
jest.mock("recharts", () => ({ Legend: () => null, ResponsiveContainer: ({ children }) => <div>{children}</div>, Tooltip: () => null }));
test("provides semantic chart series variables", () => { render(<ChartContainer aria-label="Activity chart" config={{ inbound: { color: "var(--chart-1)", label: "Inbound" } }} id="activity"><div>chart</div></ChartContainer>); expect(screen.getByLabelText("Activity chart")).toHaveAttribute("data-chart", "chart-activity"); });

test("requires tooltip content to remain inside a chart container", () => {
  const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<ChartTooltipContent active payload={[]} />)).toThrow("useChart must be used within a <ChartContainer />");
  consoleSpy.mockRestore();
});

test("renders tooltip labels, values, icons, indicators, and formatter output", () => {
  const config = { custom: { color: "red", label: "Custom" }, icon: { icon: Circle, label: "Icon" }, sales: { color: "blue", label: "Sales" } };
  const payload = [
    { color: "blue", dataKey: "sales", name: "sales", payload: { fill: "blue" }, value: 1234 },
    { color: "red", dataKey: "alias", name: "alias", payload: { alias: "custom" }, value: "ok" },
    { color: "green", dataKey: "icon", name: "icon", payload: {}, value: null },
  ];
  const { rerender } = render(<ChartContainer config={config}><ChartTooltipContent active label="sales" payload={payload} /></ChartContainer>);
  expect(screen.getAllByText("Sales")).toHaveLength(2);
  expect(screen.getByText("1,234")).toBeInTheDocument();
  expect(screen.getByText("Custom")).toBeInTheDocument();
  rerender(<ChartContainer config={config}><ChartTooltipContent active formatter={(value) => <span>formatted:{value}</span>} indicator="line" labelFormatter={(value) => `Label ${value}`} payload={[payload[0]]} /></ChartContainer>);
  expect(screen.getByText("formatted:1234")).toBeInTheDocument();
  rerender(<ChartContainer config={config}><ChartTooltipContent active hideIndicator indicator="dashed" label="sales" labelFormatter={(value) => `Label ${value}`} payload={[payload[0]]} /></ChartContainer>);
  expect(screen.getByText("Label Sales")).toBeInTheDocument();
  expect(screen.getByText("Sales")).toBeInTheDocument();
  rerender(<ChartContainer config={{}}><ChartTooltipContent active hideLabel payload={[{ dataKey: "unknown", name: "unknown", payload: {}, value: 1 }]} /></ChartContainer>);
  expect(screen.getByText("unknown")).toBeInTheDocument();
  rerender(<ChartContainer config={{}}><ChartTooltipContent active payload={[{ dataKey: "unknown", payload: {}, value: 1 }]} /></ChartContainer>);
  expect(screen.getByText("1")).toBeInTheDocument();
  rerender(<ChartContainer config={config}><ChartTooltipContent active={false} payload={payload} /></ChartContainer>);
  expect(screen.queryByText("Sales")).not.toBeInTheDocument();
});

test("renders legend variants and theme-aware chart styles", () => {
  const config = { icon: { icon: Circle, label: "Icon" }, sales: { label: "Sales", theme: { dark: "black", light: "white" } } };
  const { rerender } = render(<ChartContainer config={config}><ChartStyle config={config} id="theme" /><ChartLegendContent payload={[{ color: "blue", dataKey: "icon", type: "line" }, { color: "red", dataKey: "sales", type: "line" }, { dataKey: "ignored", type: "none" }]} verticalAlign="top" /></ChartContainer>);
  expect(screen.getByText("Icon")).toBeInTheDocument();
  expect(screen.getByText("Sales")).toBeInTheDocument();
  rerender(<ChartContainer config={config}><ChartStyle config={{ empty: { label: "Empty" } }} id="empty" /><ChartLegendContent hideIcon nameKey="series" payload={[{ color: "blue", dataKey: "ignored", series: "sales", type: "line" }, "invalid"]} /></ChartContainer>);
  expect(screen.getByText("Sales")).toBeInTheDocument();
  rerender(<ChartContainer config={config}><ChartLegendContent payload={[]} /></ChartContainer>);
  expect(screen.queryByText("Sales")).not.toBeInTheDocument();
});
