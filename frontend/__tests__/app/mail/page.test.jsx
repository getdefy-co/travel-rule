import { render, screen } from "@testing-library/react";

import Page from "@/app/mail/page";

jest.mock("@/components/app-shell", () => ({ AppShell: ({ children, requiredRoles }) => <main data-required-roles={requiredRoles.join(",")}>{children}</main> }));
jest.mock("@/components/email-delivery-dashboard", () => ({ EmailDeliveryDashboard: () => <section>Email dashboard</section> }));

test("protects email deliveries for both administrator roles", () => {
  render(<Page />);
  expect(screen.getByRole("main")).toHaveAttribute("data-required-roles", "admin,platform_admin");
  expect(screen.getByText("Email dashboard")).toBeInTheDocument();
});
