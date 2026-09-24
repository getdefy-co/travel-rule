import { render, screen } from "@testing-library/react";

import { Badge, statusBadgeVariant } from "@/components/ui/badge";

test("renders outline and custom status styling", () => {
  render(<Badge variant="outline" className="status-pending">Pending</Badge>);

  expect(screen.getByText("Pending")).toHaveAttribute("data-slot", "badge");
  expect(screen.getByText("Pending")).toHaveClass("status-pending", "text-foreground");
});

test("can pass badge behavior to a child element", () => {
  render(<Badge asChild variant="destructive"><a href="/review">Review</a></Badge>);

  expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("data-slot", "badge");
  expect(screen.getByRole("link", { name: "Review" })).toHaveClass("bg-destructive");
});

test.each([
  ["success", "border-emerald-500/30", "bg-emerald-500/10", "text-emerald-700", "dark:text-emerald-300"],
  ["warning", "border-amber-500/30", "bg-amber-500/10", "text-amber-700", "dark:text-amber-300"],
  ["danger", "border-red-500/30", "bg-red-500/10", "text-red-700", "dark:text-red-300"],
  ["info", "border-blue-500/30", "bg-blue-500/10", "text-blue-700", "dark:text-blue-300"],
  ["neutral", "border-slate-500/30", "bg-slate-500/10", "text-slate-700", "dark:text-slate-300"],
  ["accent", "border-violet-500/30", "bg-violet-500/10", "text-violet-700", "dark:text-violet-300"],
])("renders the %s semantic tone", (variant, border, background, foreground, darkForeground) => {
  render(<Badge variant={variant}>{variant}</Badge>);

  expect(screen.getByText(variant)).toHaveClass(border, background, foreground, darkForeground);
});

test.each([
  ["approved", "success"],
  ["active", "success"],
  ["consumed", "success"],
  ["delivered", "success"],
  ["sent", "success"],
  ["pending", "warning"],
  ["queued", "warning"],
  ["needs_information", "warning"],
  ["rejected", "danger"],
  ["dead_lettered", "danger"],
  ["failed", "danger"],
  ["confirmed", "info"],
  ["processing", "info"],
  ["received", "info"],
  ["canceled", "neutral"],
  ["disabled", "neutral"],
  ["inactive", "neutral"],
  ["revoked", "neutral"],
  ["expired", "accent"],
  ["escalated", "accent"],
  ["unexpected", "neutral"],
])("maps %s to the %s semantic tone", (status, variant) => {
  expect(statusBadgeVariant(status)).toBe(variant);
});
