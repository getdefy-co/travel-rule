import { render, screen } from "@testing-library/react";

import Page from "@/app/users/page";

jest.mock("@/components/app-shell", () => ({ AppShell: ({ children, requiredRole }) => <main data-required-role={requiredRole}>{children}</main> }));
jest.mock("@/components/user-management", () => ({
  UserManagement: () => <section aria-label="User management">managed-users</section>,
}));

test("assembles an exact-admin protected user management shell", () => {
  render(<Page />);

  expect(screen.getByRole("main")).toHaveAttribute("data-required-role", "admin");
  expect(screen.getByRole("region", { name: "User management" })).toBeInTheDocument();
  expect(screen.getByText("managed-users")).toBeInTheDocument();
});
