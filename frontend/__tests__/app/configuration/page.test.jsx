import { render, screen } from "@testing-library/react";
import Page from "@/app/configuration/page";
jest.mock("@/components/app-shell", () => ({ AppShell: ({ children, requiredRole }) => <main data-required-role={requiredRole}>{children}</main> }));
jest.mock("@/components/configuration-panel", () => ({ ConfigurationPanel: () => <section>configuration</section> }));
test("protects Configuration with the exact-admin shared shell", () => { render(<Page />); expect(screen.getByRole("main")).toHaveAttribute("data-required-role", "admin"); expect(screen.getByText("configuration")).toBeInTheDocument(); });
