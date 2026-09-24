import { render, screen } from "@testing-library/react";
import Page from "@/app/travel-rule/messages/page";
jest.mock("@/components/app-shell", () => ({ AppShell: ({ children, requiredRoles }) => <main data-required-roles={requiredRoles?.join(",")}>{children}</main> }));
jest.mock("@/components/resource-dashboard", () => ({ ResourceDashboard: ({ resource }) => <section>{resource}</section> }));
test("restricts messages to management-viewer roles", () => { render(<Page />); expect(screen.getByRole("main")).toHaveAttribute("data-required-roles", "auditor,integration_operator,platform_admin"); expect(screen.getByRole("main")).toHaveTextContent("messages"); });
