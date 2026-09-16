import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NavUser } from "@/components/nav-user";

const mockLogout = jest.fn();
let mockMobile = false;
let mockUser = { email: "admin@example.com", role: "admin" };

jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser, logout: mockLogout }) }));
jest.mock("@/components/ui/sidebar", () => ({
  useSidebar: () => ({ isMobile: mockMobile }),
  SidebarMenu: ({ children }) => <ul>{children}</ul>,
  SidebarMenuItem: ({ children }) => <li>{children}</li>,
  SidebarMenuButton: ({ children }) => <button>{children}</button>,
}));
jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>, DropdownMenuTrigger: ({ children }) => children,
  DropdownMenuContent: ({ children, side }) => <div data-testid="user-menu" data-side={side}>{children}</div>,
  DropdownMenuGroup: ({ children }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }) => <div>{children}</div>, DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ asChild, children, onClick }) => asChild ? children : <button onClick={onClick}>{children}</button>,
}));
jest.mock("@/components/settings-modal", () => ({ SettingsModal: ({ open }) => <span>settings:{String(open)}</span> }));
jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href }) => <a href={href}>{children}</a> }));

beforeEach(() => {
  mockMobile = false;
  mockUser = { email: "admin@example.com", role: "admin" };
  mockLogout.mockClear();
});

test("shows account information, opens Settings, and logs out directly", async () => {
  const user = userEvent.setup();
  render(<NavUser />);

  expect(screen.getAllByText("Admin")).toHaveLength(2);
  expect(screen.getByRole("link", { name: "Configuration" })).toHaveAttribute("href", "/configuration");
  await user.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByText("settings:true")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Log out" }));
  expect(mockLogout).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("user-menu")).toHaveAttribute("data-side", "right");
});

test("uses the mobile menu placement and supports users without a role", () => {
  mockMobile = true;
  mockUser = { email: "member@example.com" };
  render(<NavUser />);

  expect(screen.getByTestId("user-menu")).toHaveAttribute("data-side", "bottom");
  expect(screen.getAllByText("member@example.com")).toHaveLength(2);
  expect(screen.queryByRole("link", { name: "Configuration" })).not.toBeInTheDocument();
});

test("lets a normal user open Update and starts with an empty email on each opening", async () => {
  const user = userEvent.setup();
  mockUser = { email: "member@example.com", role: "user" };
  render(<NavUser />);
  await user.click(screen.getByRole("button", { name: "Update" }));
  expect(screen.getByRole("dialog", { name: "Project updates" })).toBeInTheDocument();
  await user.type(screen.getByLabelText("Email"), "draft@example.test");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Update" }));
  expect(screen.getByLabelText("Email")).toHaveValue("");
});
