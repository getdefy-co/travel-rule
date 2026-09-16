import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiReference, httpMethodBadgeVariant } from "@/components/api-reference";

const setItemSpy = jest.spyOn(Storage.prototype, "setItem");

beforeEach(() => {
  setItemSpy.mockClear();
});

test("maps every documented HTTP method to a semantic badge tone", () => {
  expect(httpMethodBadgeVariant("GET")).toBe("info");
  expect(httpMethodBadgeVariant("POST")).toBe("success");
  expect(httpMethodBadgeVariant("PUT")).toBe("warning");
  expect(httpMethodBadgeVariant("DELETE")).toBe("danger");
});

test("presents all endpoint groups and the complete searchable reference", () => {
  render(<ApiReference />);

  const reference = screen.getByRole("region", { name: "Travel Rule API reference" });
  expect(within(reference).getByRole("heading", { name: "API reference", level: 1 })).toBeInTheDocument();
  expect(within(reference).getByRole("searchbox", { name: "Search endpoints" })).toBeInTheDocument();
  expect(within(reference).getByRole("status")).toHaveTextContent("47 endpoints");

  for (const group of [
    "Protocol-neutral integration",
    "Compliance operations",
    "Direct TRP compatibility",
    "TRP operator APIs",
    "Public peer protocol",
  ]) {
    expect(within(reference).getByRole("heading", { name: group, level: 2 })).toBeInTheDocument();
  }

  for (const endpoint of [
    "/travel-rule/v1/transfers",
    "/travel-rule/v1/transfers/:id/information",
    "/travel-rule/v1/webhook-subscriptions",
    "/travel-rule/v1/cases/:id/decisions",
    "/travel-rule/v1/encryption/reencryption-jobs",
    "/travel-rule/trp/travel-addresses",
    "/travel-rule/trp/transfers/:id/retry",
    "/travel-rule/trp/inquiries/:id/decision",
    "/travel-rule/trp/management/analytics",
    "/travel-rule/trp/management/messages/:id",
    "/travel-rule/trp/management/transfers/:id/email-invitations",
    "/travel-rule/trp/management/emails",
    "/travel-rule/trp/email-access/consume",
    "/identity",
    "/travel-rule/trp/protocol/confirmations/:token",
  ]) {
    expect(within(reference).getAllByText(endpoint, { exact: true }).length).toBeGreaterThan(0);
  }

  const getEndpoint = within(reference).getByRole("group", { name: "GET /travel-rule/v1/transfers/:id" });
  const postEndpoint = within(reference).getByRole("group", { name: "POST /travel-rule/v1/transfers" });
  const deleteEndpoint = within(reference).getByRole("group", { name: "DELETE /travel-rule/v1/webhook-subscriptions/:id" });
  expect(within(getEndpoint).getByText("GET")).toHaveClass("border-blue-500/30", "bg-blue-500/10");
  expect(within(postEndpoint).getByText("POST")).toHaveClass("border-emerald-500/30", "bg-emerald-500/10");
  expect(within(deleteEndpoint).getByText("DELETE")).toHaveClass("border-red-500/30", "bg-red-500/10");
});

test("filters endpoints by search text across endpoint metadata", async () => {
  const user = userEvent.setup();
  render(<ApiReference />);

  await user.type(screen.getByRole("searchbox", { name: "Search endpoints" }), "mTLS");

  expect(screen.getByRole("status")).toHaveTextContent("3 endpoints");
  expect(screen.getByText("/travel-rule/trp/protocol/inquiries/:token", { exact: true })).toBeInTheDocument();
  expect(screen.getByText("/travel-rule/trp/protocol/resolutions/:token", { exact: true })).toBeInTheDocument();
  expect(screen.getByText("/travel-rule/trp/protocol/confirmations/:token", { exact: true })).toBeInTheDocument();
  expect(screen.queryByText("/travel-rule/v1/transfers", { exact: true })).not.toBeInTheDocument();
  expect(setItemSpy).not.toHaveBeenCalled();
});

test("filters by endpoint group and exposes endpoint details on demand", async () => {
  const user = userEvent.setup();
  render(<ApiReference />);

  const groupFilter = screen.getByRole("button", { name: "Protocol-neutral integration" });
  await user.click(groupFilter);

  expect(groupFilter).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("status")).toHaveTextContent("9 endpoints");
  expect(screen.queryByText("/identity", { exact: true })).not.toBeInTheDocument();

  const endpointDetails = screen.getByRole("group", { name: "POST /travel-rule/v1/transfers" });
  expect(endpointDetails).not.toHaveAttribute("open");

  await user.click(within(endpointDetails).getByText("/travel-rule/v1/transfers", { exact: true }));

  expect(endpointDetails).toHaveAttribute("open");
  expect(within(endpointDetails).getByText("X-API-Key · transfers:write", { exact: true })).toBeInTheDocument();
  expect(within(endpointDetails).getByText("backend:3002", { exact: true })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "All" }));

  expect(screen.getByRole("status")).toHaveTextContent("47 endpoints");
});

test("shows an accessible empty state when no endpoint matches", async () => {
  const user = userEvent.setup();
  render(<ApiReference />);

  await user.type(screen.getByRole("searchbox", { name: "Search endpoints" }), "not-a-real-endpoint");

  expect(screen.getByRole("status")).toHaveTextContent("0 endpoints");
  expect(screen.getByText("No endpoints match your search and category filters.")).toBeInTheDocument();
});
