import { render, screen, waitFor } from "@testing-library/react";

import Page from "@/app/login/page";
import { useAuth } from "@/contexts/AuthContext";

const mockPush = jest.fn();
let mockResetToken = null;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: (key) => (key === "rpt" ? mockResetToken : null) }),
}));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: jest.fn() }));
jest.mock("@/components/login-form", () => ({ LoginForm: ({ isResetMode, resetToken }) => <div>login-form:{String(isResetMode)}:{resetToken || "none"}</div> }));

beforeEach(() => {
  mockResetToken = null;
  mockPush.mockClear();
});

test("shows a loading state during authentication bootstrap", () => {
  useAuth.mockReturnValue({ isLoading: true, isAuthenticated: false });
  render(<Page />);
  expect(screen.queryByText(/login-form/)).not.toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
});

test("renders reset mode from the route token", () => {
  mockResetToken = "reset-token";
  useAuth.mockReturnValue({ isLoading: false, isAuthenticated: false });
  render(<Page />);
  expect(screen.getByRole("main")).toHaveAccessibleName("Reset Password");
  expect(screen.getByRole("heading", { level: 1, name: "Reset Password" })).toBeInTheDocument();
  expect(screen.getByText("login-form:true:reset-token")).toBeInTheDocument();
});

test("redirects authenticated users without rendering the form", async () => {
  useAuth.mockReturnValue({ isLoading: false, isAuthenticated: true });
  render(<Page />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  expect(screen.queryByText(/login-form/)).not.toBeInTheDocument();
});
