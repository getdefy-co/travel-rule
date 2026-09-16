import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

let mockTheme = "light";
let mockResolvedTheme = "light";
let mockIsMobile = false;
let mockPathname = "/";
let mockAuth = { user: { role: "user" } };
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));
jest.mock("next-themes", () => ({ useTheme: () => ({ theme: mockTheme, resolvedTheme: mockResolvedTheme }) }));
jest.mock("next/image", () => ({ __esModule: true, default: function MockImage({ src, alt }) { return <span role="img" aria-label={alt} data-src={src} />; } }));
jest.mock("@/components/nav-user", () => ({ NavUser: () => <div>User nav</div> }));
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mockIsMobile }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockAuth }));

beforeEach(() => {
  mockTheme = "light";
  mockResolvedTheme = "light";
  mockIsMobile = false;
  mockPathname = "/";
  mockAuth = { user: { role: "user" } };
});

test.each([["light", "light", "/logo_text.png"], ["dark", "dark", "/logo_text_dark.png"], ["system", "light", "/logo_text.png"], ["system", "dark", "/logo_text_dark.png"]])("renders the %s/%s Defy logo, Travel Rule routes, and hides Users from non-admin navigation", (theme, resolvedTheme, logo) => {
  mockTheme = theme;
  mockResolvedTheme = resolvedTheme;
  render(<SidebarProvider><SidebarTrigger /><AppSidebar /></SidebarProvider>);

  expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Defy" })).toHaveAttribute("data-src", logo);
  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");
  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("data-active", "true");
  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByText("TRAVEL RULE")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Transfers" })).toHaveAttribute("href", "/travel-rule/transfers");
  expect(screen.getByRole("link", { name: "Inquiries" })).toHaveAttribute("href", "/travel-rule/inquiries");
  expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("href", "/travel-rule/messages");
  expect(screen.getByRole("link", { name: "Tokens" })).toHaveAttribute("href", "/travel-rule/tokens");
  expect(screen.getByRole("link", { name: "Events" })).toHaveAttribute("href", "/travel-rule/events");
  expect(screen.getByRole("link", { name: "Cases" })).toHaveAttribute("href", "/compliance/cases");
  expect(screen.getByText("COMPLIANCE")).toBeInTheDocument();
  expect(screen.queryByText("MANAGEMENT")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Email deliveries" })).not.toBeInTheDocument();
  expect(screen.getByText("User nav")).toBeInTheDocument();
});

test("shows the management group after Travel Rule navigation and marks the current admin destination active", () => {
  mockPathname = "/users";
  mockAuth = { user: { role: "admin" } };
  render(<SidebarProvider><AppSidebar /></SidebarProvider>);

  const dashboard = screen.getByRole("link", { name: "Dashboard" });
  const users = screen.getByRole("link", { name: "Users" });

  expect(dashboard).toHaveAttribute("data-active", "false");
  expect(dashboard).not.toHaveAttribute("aria-current");
  expect(users).toHaveAttribute("href", "/users");
  expect(users).toHaveAttribute("data-active", "true");
  expect(users).toHaveAttribute("aria-current", "page");
  expect(screen.getByText("MANAGEMENT")).toBeInTheDocument();
  expect(screen.getByText("MAIL")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Email deliveries" })).toHaveAttribute("href", "/mail");
  expect(screen.getByRole("link", { name: "Events" }).compareDocumentPosition(users) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("marks nested Travel Rule destinations active", () => {
  mockPathname = "/travel-rule/messages";
  render(<SidebarProvider><AppSidebar /></SidebarProvider>);

  expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("data-active", "true");
  expect(screen.getByRole("link", { name: "Messages" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("data-active", "false");
});

test("shows both API Docs destinations to every authenticated role and activates only the guide", () => {
  mockPathname = "/api-docs";
  mockAuth = { user: { role: "integration_operator" } };
  render(<SidebarProvider><AppSidebar /></SidebarProvider>);

  const events = screen.getByRole("link", { name: "Events" });
  const integrationGuide = screen.getByRole("link", { name: "Integration Guide" });
  const apiReference = screen.getByRole("link", { name: "API Reference" });
  const cases = screen.queryByRole("link", { name: "Cases" });

  expect(screen.getByText("API DOCS")).toBeInTheDocument();
  expect(integrationGuide).toHaveAttribute("href", "/api-docs");
  expect(integrationGuide).toHaveAttribute("data-active", "true");
  expect(integrationGuide).toHaveAttribute("aria-current", "page");
  expect(apiReference).toHaveAttribute("href", "/api-docs/reference");
  expect(apiReference).toHaveAttribute("data-active", "false");
  expect(apiReference).not.toHaveAttribute("aria-current");
  expect(events.compareDocumentPosition(integrationGuide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(integrationGuide.compareDocumentPosition(apiReference) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(cases).not.toBeInTheDocument();
});

test("activates only API Reference on the nested reference route", () => {
  mockPathname = "/api-docs/reference";
  render(<SidebarProvider><AppSidebar /></SidebarProvider>);

  expect(screen.getByRole("link", { name: "Integration Guide" })).toHaveAttribute("data-active", "false");
  expect(screen.getByRole("link", { name: "Integration Guide" })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("link", { name: "API Reference" })).toHaveAttribute("data-active", "true");
  expect(screen.getByRole("link", { name: "API Reference" })).toHaveAttribute("aria-current", "page");
});

test.each(["auditor", "integration_operator"])("hides inquiry review from the %s role", (role) => {
  mockAuth = { user: { role } };
  render(<SidebarProvider><AppSidebar /></SidebarProvider>);

  expect(screen.queryByRole("link", { name: "Inquiries" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Transfers" })).toBeInTheDocument();
});

test("keeps the mobile Sheet dialog and nests the localized navigation landmark inside it", async () => {
  mockIsMobile = true;
  const user = userEvent.setup();
  render(<SidebarProvider><SidebarTrigger /><AppSidebar /></SidebarProvider>);

  await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));

  const dialog = await screen.findByRole("dialog", { name: "Sidebar navigation" });
  expect(within(dialog).getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
});
