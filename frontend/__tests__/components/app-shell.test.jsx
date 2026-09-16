import { render, screen } from "@testing-library/react";

import { AppShell } from "@/components/app-shell";

jest.mock("@/components/protected-route", () => ({
  __esModule: true,
  default: ({ children, requiredRole, unauthorizedRedirectTo }) => <main data-required-role={requiredRole} data-unauthorized-redirect={unauthorizedRedirectTo}>{children}</main>,
}));
jest.mock("@/components/app-sidebar", () => ({ AppSidebar: ({ variant }) => <div>sidebar:{variant}</div> }));
jest.mock("@/components/site-header", () => ({ SiteHeader: () => <header>site-header</header> }));
jest.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children, style }) => <div data-sidebar-width={style["--sidebar-width"]}>{children}</div>,
  SidebarInset: ({ children }) => <section aria-label="Application content">{children}</section>,
}));

test("provides one responsive protected application shell for authenticated pages", () => {
  render(<AppShell><p>page body</p></AppShell>);

  expect(screen.getByRole("main")).not.toHaveAttribute("data-required-role");
  expect(screen.getByText("sidebar:inset")).toBeInTheDocument();
  expect(screen.getByText("site-header")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Application content" })).toHaveTextContent("page body");
});

test("passes exact-admin protection through for management pages", () => {
  render(<AppShell requiredRole="admin"><p>admin body</p></AppShell>);

  expect(screen.getByRole("main")).toHaveAttribute("data-required-role", "admin");
  expect(screen.getByRole("main")).toHaveAttribute("data-unauthorized-redirect", "/");
});
