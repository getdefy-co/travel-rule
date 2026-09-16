import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import i18n from "@/i18n/config";

import { SettingsModal } from "@/components/settings-modal";

const mockLogout = jest.fn();
const mockSetTheme = jest.fn();
let mockUser;

jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser, logout: mockLogout }) }));
jest.mock("next-themes", () => ({ useTheme: () => ({ theme: "light", setTheme: mockSetTheme }) }));
jest.mock("@/components/change-password-modal", () => ({ ChangePasswordModal: ({ open, onOpenChange }) => open ? <div><span>Password modal</span><button onClick={() => onOpenChange(false)}>Close password</button></div> : null }));
jest.mock("@/components/ui/select", () => {
  const React = jest.requireActual("react");
  const Context = React.createContext(null);
  return {
    Select: ({ children, onValueChange }) => <Context.Provider value={onValueChange}>{children}</Context.Provider>,
    SelectTrigger: ({ children }) => <div>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }) => <div>{children}</div>,
    SelectItem: ({ children, value }) => { const change = React.useContext(Context); return <button onClick={() => change(value)}>{children}</button>; },
  };
});

beforeEach(() => {
  mockUser = { email: "admin@example.com", role: "admin", created_at: "2026-01-02T00:00:00Z" };
  mockLogout.mockResolvedValue({ success: true });
  jest.spyOn(toast, "success").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("shows user metadata and handles preferences, password and logout", async () => {
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  jest.spyOn(i18n, "changeLanguage").mockResolvedValue();
  render(<SettingsModal open onOpenChange={onOpenChange} />);
  expect(screen.getByText("admin@example.com")).toBeInTheDocument();
  expect(screen.getByText("Admin")).toBeInTheDocument();
  expect(screen.getByText("January 2, 2026")).toBeInTheDocument();
  expect(screen.getByText("Choose your preferred color theme.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Dark" }));
  expect(mockSetTheme).toHaveBeenCalledWith("dark");
  await user.click(screen.getByRole("button", { name: "English" }));
  await waitFor(() => expect(i18n.changeLanguage).toHaveBeenCalledWith("en"));
  await user.click(screen.getByRole("button", { name: /change password/i }));
  expect(screen.getByText("Password modal")).toBeInTheDocument();
  const successCallsBeforeLogout = toast.success.mock.calls.length;
  await user.click(screen.getByRole("button", { name: /sign out/i }));
  expect(mockLogout).toHaveBeenCalled();
  expect(toast.success).toHaveBeenCalledTimes(successCallsBeforeLogout);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("uses fallbacks for absent user metadata", () => {
  mockUser = null;
  render(<SettingsModal open onOpenChange={jest.fn()} />);
  expect(screen.getAllByText("N/A")).toHaveLength(3);
});
