import { render, screen } from "@testing-library/react";

import ProtectedRoute from "@/components/protected-route";

const mockPush = jest.fn();
let mockAuth;

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockAuth }));

beforeEach(() => {
  mockPush.mockClear();
  mockAuth = { isAuthenticated: true, isLoading: false, user: { role: "integration_operator" } };
});

test("shows the loading boundary without protected content", () => {
  mockAuth = { isAuthenticated: false, isLoading: true };
  render(<ProtectedRoute><p>Secret</p></ProtectedRoute>);
  expect(screen.queryByText("Secret")).not.toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  expect(mockPush).not.toHaveBeenCalled();
});

test("redirects only unauthenticated users to the configured login route", () => {
  mockAuth = { isAuthenticated: false, isLoading: false };
  render(<ProtectedRoute redirectTo="/sign-in"><p>Secret</p></ProtectedRoute>);
  expect(screen.queryByText("Secret")).not.toBeInTheDocument();
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith("/sign-in");
});

test("renders authenticated users without role or onboarding redirects", () => {
  render(<ProtectedRoute><p>Secret</p></ProtectedRoute>);
  expect(screen.getByText("Secret")).toBeInTheDocument();
  expect(mockPush).not.toHaveBeenCalled();
});

test("redirects an authenticated non-platform-admin away from a platform-admin-only route", () => {
  mockAuth = { isAuthenticated: true, isLoading: false, user: { role: "integration_operator" } };
  render(<ProtectedRoute requiredRole="platform_admin"><p>Admin content</p></ProtectedRoute>);

  expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith("/");
});

test("renders an authenticated platform admin inside a platform-admin-only route", () => {
  mockAuth = { isAuthenticated: true, isLoading: false, user: { role: "platform_admin" } };
  render(<ProtectedRoute requiredRole="platform_admin"><p>Admin content</p></ProtectedRoute>);

  expect(screen.getByText("Admin content")).toBeInTheDocument();
  expect(mockPush).not.toHaveBeenCalled();
});

test("accepts any role in an explicit role set", () => {
  mockAuth = { isAuthenticated: true, isLoading: false, user: { role: "auditor" } };
  render(<ProtectedRoute requiredRoles={["auditor", "compliance_reviewer"]}><p>Case queue</p></ProtectedRoute>);

  expect(screen.getByText("Case queue")).toBeInTheDocument();
  expect(mockPush).not.toHaveBeenCalled();
});
