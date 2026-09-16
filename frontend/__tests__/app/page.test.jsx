import { render, screen } from "@testing-library/react";

import Page from "@/app/page";

jest.mock("@/components/app-shell", () => ({ AppShell: ({ children }) => <main>{children}</main> }));
jest.mock("@/components/travel-rule-dashboard", () => ({ TravelRuleDashboard: () => <section aria-label="Travel Rule analytics">analytics</section> }));

test("assembles the Travel Rule analytics page in the shared shell", () => {
  render(<Page />);

  expect(screen.getByRole("main")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Travel Rule analytics" })).toHaveTextContent("analytics");
});
