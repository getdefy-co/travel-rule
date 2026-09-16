import { act, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { toast } from "sonner";

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import * as api from "@/lib/api";

jest.mock("@/lib/api", () => ({ getUserInfo: jest.fn(), loginUser: jest.fn(), logoutUser: jest.fn() }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

let currentAuth;

const Probe = () => {
  const auth = useAuth();
  useEffect(() => {
    currentAuth = auth;
  }, [auth]);
  return (
    <div>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="email">{auth.user?.email || "none"}</span>
      <span data-testid="error">{auth.error || "none"}</span>
    </div>
  );
};

const renderProvider = () => render(<AuthProvider><Probe /></AuthProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  api.loginUser.mockReset();
  api.getUserInfo.mockReset();
  api.logoutUser.mockReset();
  api.logoutUser.mockResolvedValue(undefined);
});

describe("AuthProvider", () => {
  test("finishes unauthenticated bootstrap when no cookie session exists", async () => {
    const error = new Error("unauthenticated");
    error.status = 401;
    api.getUserInfo.mockRejectedValue(error);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(api.getUserInfo).toHaveBeenCalledWith();
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("reports a non-authentication bootstrap failure once under StrictMode", async () => {
    api.getUserInfo.mockRejectedValue(new Error("Session service unavailable"));

    render(<StrictMode><AuthProvider><Probe /></AuthProvider></StrictMode>);

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Session service unavailable", { id: "auth-session-restore-error" });
  });

  test("restores a cookie session without persisting user data", async () => {
    api.getUserInfo.mockResolvedValue({ email: "user@getdefy.co", role: "user", created_at: "2026-01-01T00:00:00.000Z" });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("email")).toHaveTextContent("user@getdefy.co"));
    expect(api.getUserInfo).toHaveBeenCalledWith();
    expect(localStorage.getItem("userData")).toBeNull();
  });

  test.each(["admin", "user", "platform_admin", "integration_operator", "compliance_reviewer", "compliance_approver", "auditor"])("restores a cookie session for the supported %s role", async (role) => {
    api.getUserInfo.mockResolvedValue({ email: `${role}@getdefy.co`, role, created_at: "2026-01-01T00:00:00.000Z" });
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("authenticated")).toHaveTextContent("true"));
    expect(screen.getByTestId("email")).toHaveTextContent(`${role}@getdefy.co`);
    expect(localStorage.getItem("authToken")).toBeNull();
  });

  test("clears an invalid stored token", async () => {
    localStorage.setItem("authToken", "expired");
    api.getUserInfo.mockRejectedValue(new Error("expired"));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(localStorage.getItem("authToken")).toBeNull();
  });

  test.each([
    ["null", null],
    ["an array", []],
    ["a missing creation date", { email: "user@getdefy.co", role: "user" }],
    ["a whitespace-only email", { email: "   ", role: "user", created_at: "2026-01-01T00:00:00.000Z" }],
    ["a whitespace-only role", { email: "user@getdefy.co", role: "   ", created_at: "2026-01-01T00:00:00.000Z" }],
    ["the retired super_admin role", { email: "user@getdefy.co", role: "super_admin", created_at: "2026-01-01T00:00:00.000Z" }],
    ["a case-variant admin role", { email: "user@getdefy.co", role: "Admin", created_at: "2026-01-01T00:00:00.000Z" }],
    ["an unknown viewer role", { email: "user@getdefy.co", role: "viewer", created_at: "2026-01-01T00:00:00.000Z" }],
  ])("does not authenticate or retain a stored token for %s user data", async (_name, user) => {
    localStorage.setItem("authToken", "stored");
    api.getUserInfo.mockResolvedValue(user);
    renderProvider();

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(localStorage.getItem("authToken")).toBeNull();
  });

  test("logs in, exposes the retained context contract, clears errors, and logs out", async () => {
    api.loginUser.mockResolvedValue(true);
    api.getUserInfo.mockResolvedValue({ email: "login@getdefy.co", role: "user", created_at: "2026-01-01T00:00:00.000Z" });
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    let loginResult;
    await act(async () => {
      loginResult = await currentAuth.login({ email: "login@getdefy.co", password: "secret" });
    });

    expect(loginResult).toEqual({ success: true, user: { email: "login@getdefy.co", role: "user", created_at: "2026-01-01T00:00:00.000Z" } });
    expect(localStorage.getItem("authToken")).toBeNull();
    expect(localStorage.getItem("userData")).toBeNull();
    expect(Object.keys(currentAuth).sort()).toEqual(["clearError", "error", "isAuthenticated", "isLoading", "login", "logout", "user"]);
    act(() => currentAuth.clearError());
    expect(screen.getByTestId("error")).toHaveTextContent("none");
    await act(async () => currentAuth.logout());
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(localStorage.getItem("authToken")).toBeNull();
    expect(api.logoutUser).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Successfully logged out", { id: "auth-logout-result" });
  });

  test("reports login errors without authenticating", async () => {
    api.loginUser.mockRejectedValue(new Error("invalid credentials"));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    let result;
    await act(async () => {
      result = await currentAuth.login({ email: "a", password: "b" });
    });
    expect(result).toEqual({ success: false, error: "invalid credentials" });
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
  });

  test("keeps the local session closed and reports a remote logout failure", async () => {
    api.getUserInfo.mockResolvedValue({ email: "logout@getdefy.co", role: "user", created_at: "2026-01-01T00:00:00.000Z" });
    api.logoutUser.mockRejectedValueOnce(new Error("Logout unavailable"));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("authenticated")).toHaveTextContent("true"));

    await act(async () => currentAuth.logout());

    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(screen.getByTestId("error")).toHaveTextContent("Logout unavailable");
    expect(toast.error).toHaveBeenCalledWith("Logout unavailable", { id: "auth-logout-result" });
    expect(toast.success).not.toHaveBeenCalled();
  });

  test("shares one remote request across concurrent logout calls", async () => {
    let resolveLogout;
    api.getUserInfo.mockResolvedValue({ email: "logout@getdefy.co", role: "user", created_at: "2026-01-01T00:00:00.000Z" });
    api.logoutUser.mockReturnValueOnce(new Promise((resolve) => {
      resolveLogout = resolve;
    }));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("authenticated")).toHaveTextContent("true"));

    let first;
    let second;
    act(() => {
      first = currentAuth.logout();
      second = currentAuth.logout();
    });

    expect(second).toBe(first);
    expect(api.logoutUser).toHaveBeenCalledTimes(1);
    await act(async () => resolveLogout());
    await expect(first).resolves.toEqual({ success: true });
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  test("rejects an empty authentication token before persisting it", async () => {
    api.loginUser.mockResolvedValue(undefined);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    let result;
    await act(async () => {
      result = await currentAuth.login({ email: "a", password: "b" });
    });

    expect(result).toEqual({ success: false, error: "No token received from login response" });
    expect(localStorage.getItem("authToken")).toBeNull();
  });

  test.each([
    ["a missing creation date", { email: "login@getdefy.co", role: "user" }],
    ["a whitespace-only email", { email: "   ", role: "user", created_at: "2026-01-01T00:00:00.000Z" }],
    ["a whitespace-only role", { email: "login@getdefy.co", role: "   ", created_at: "2026-01-01T00:00:00.000Z" }],
    ["the retired super_admin role", { email: "login@getdefy.co", role: "super_admin", created_at: "2026-01-01T00:00:00.000Z" }],
  ])("does not authenticate or persist a token when login returns %s", async (_name, user) => {
    api.loginUser.mockResolvedValue(true);
    api.getUserInfo.mockResolvedValue(user);
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));

    let result;
    await act(async () => {
      result = await currentAuth.login({ email: "login@getdefy.co", password: "secret" });
    });

    expect(result).toEqual({ success: false, error: "Invalid user information" });
    expect(screen.getByTestId("authenticated")).toHaveTextContent("false");
    expect(localStorage.getItem("authToken")).toBeNull();
  });
});

test("useAuth rejects consumers outside AuthProvider", () => {
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<Probe />)).toThrow(/Auth/i);
  consoleError.mockRestore();
});

test.each([
  ["restore", "resolve"], ["restore", "reject"],
  ["login", "resolve"], ["login", "reject"],
  ["logout", "resolve"], ["logout", "reject"],
])("ignores a %s %s after the provider unmounts", async (operation, outcome) => {
  const user = { email: "operator@example.test", role: "user", created_at: "2026-01-01T00:00:00.000Z" };
  let finish;
  const pending = new Promise((resolve, reject) => { finish = outcome === "resolve" ? resolve : reject; });
  api.getUserInfo.mockResolvedValue(user);
  if (operation === "restore") api.getUserInfo.mockReturnValueOnce(pending);
  const { unmount } = renderProvider();
  let operationResult;
  if (operation !== "restore") {
    await screen.findByText(user.email);
    act(() => {
      if (operation === "login") {
        api.loginUser.mockReturnValueOnce(pending);
        operationResult = currentAuth.login({ email: user.email, password: "test-password" });
      } else {
        api.logoutUser.mockReturnValueOnce(pending);
        operationResult = currentAuth.logout();
      }
    });
  }
  unmount();
  await act(async () => {
    finish(outcome === "reject" ? new Error("late failure") : operation === "restore" ? user : true);
    await operationResult;
  });
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});
