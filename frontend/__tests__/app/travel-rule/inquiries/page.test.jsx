import { render, screen } from "@testing-library/react";
import Page from "@/app/travel-rule/inquiries/page";
jest.mock("@/components/app-shell", () => ({ AppShell: ({ children, requiredRoles }) => <main data-required-roles={requiredRoles?.join(",") || ""}>{children}</main> }));
jest.mock("@/components/inquiry-dashboard", () => ({ InquiryDashboard: () => <section>inquiries</section> }));
test("matches the inquiry-review backend role boundary", () => {
  render(<Page />);

  expect(screen.getByRole("main")).toHaveAttribute("data-required-roles", "admin,compliance_approver,compliance_reviewer,platform_admin,user");
  expect(screen.getByText("inquiries")).toBeInTheDocument();
});
