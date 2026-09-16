import { render, screen } from "@testing-library/react";

import Page from "@/app/compliance/cases/page";

jest.mock("@/components/app-shell", () => ({ AppShell: ({ children, requiredRoles }) => <main data-required-roles={requiredRoles.join(",")}>{children}</main> }));
jest.mock("@/components/compliance-case-dashboard", () => ({ ComplianceCaseDashboard: () => <section aria-label="Compliance cases">cases</section> }));

test("assembles the role-bounded compliance case shell", () => {
  render(<Page />);

  expect(screen.getByRole("main")).toHaveAttribute("data-required-roles", "admin,auditor,compliance_approver,compliance_reviewer,platform_admin,user");
  expect(screen.getByRole("region", { name: "Compliance cases" })).toBeInTheDocument();
});
