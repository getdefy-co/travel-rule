import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { LoginForm } from "@/components/login-form";
import { forgotPassword, resetPassword } from "@/lib/api";

const mockLogin = jest.fn();
const mockClearError = jest.fn();
const mockPush = jest.fn();
let mockAuthLoading = false;
let mockAuthError = null;
let mockTheme = "light";
let mockResolvedTheme = "light";

const submitTwiceBeforeReactFlush = (control) => {
  fireEvent.submit(control);
  fireEvent.submit(control);
};

jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ login: mockLogin, clearError: mockClearError, isLoading: mockAuthLoading, error: mockAuthError }) }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("next-themes", () => ({ useTheme: () => ({ theme: mockTheme, resolvedTheme: mockResolvedTheme }) }));
jest.mock("next/image", () => ({ __esModule: true, default: function MockImage({ src, alt }) { return <span role="img" aria-label={alt} data-src={src} />; } }));
jest.mock("@/lib/api", () => ({ forgotPassword: jest.fn(), resetPassword: jest.fn() }));

beforeEach(() => {
  mockAuthLoading = false; mockAuthError = null; mockTheme = "light"; mockResolvedTheme = "light";
  jest.spyOn(toast, "error").mockImplementation(() => {});
  jest.spyOn(toast, "success").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test("validates login and routes after successful authentication", async () => {
  const user = userEvent.setup();
  mockLogin.mockResolvedValue({ success: true });
  render(<LoginForm className="custom" data-testid="login-form" />);
  expect(screen.getByLabelText("Email")).toHaveAttribute("placeholder", "user@example.com");
  fireEvent.submit(screen.getByRole("button", { name: "Login" }));
  expect(toast.error).toHaveBeenCalledWith("2 fields need attention. Email: Please enter both email and password.");
  await user.type(screen.getByLabelText("Email"), "invalid");
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Login" }));
  expect(toast.error).toHaveBeenCalledWith("Invalid email", expect.any(Object));
  await user.clear(screen.getByLabelText("Email"));
  await user.type(screen.getByLabelText("Email"), "user@example.com");
  await user.click(screen.getByRole("button", { name: "Login" }));
  await waitFor(() => expect(mockLogin).toHaveBeenCalledWith({ email: "user@example.com", password: "secret" }));
  expect(mockClearError).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith("/");
  expect(screen.getByRole("img", { name: "Defy" })).toHaveAttribute("data-src", "/logo_text.png");
});

test("shows auth state and does not route unsuccessful login", () => {
  mockAuthLoading = true; mockAuthError = "Denied"; mockTheme = "dark"; mockResolvedTheme = "dark";
  mockLogin.mockResolvedValue({ success: false });
  render(<LoginForm />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Signing in..." })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();
  expect(screen.getByRole("img", { name: "Defy" })).toHaveAttribute("data-src", "/logo_text_dark.png");
});

test("uses browser credential autocomplete semantics across login and password reset", async () => {
  const user = userEvent.setup();
  render(<LoginForm />);

  expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
  expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");

  await user.click(screen.getByRole("button", { name: /forgot password/i }));
  expect(screen.getByLabelText("Email", { selector: "#forgot-email" })).toHaveAttribute("autocomplete", "email");
});

test("keeps users on login after an unsuccessful submitted credential request", async () => {
  const user = userEvent.setup();
  mockLogin.mockResolvedValue({ success: false, error: "Denied" });
  render(<LoginForm />);
  await user.type(screen.getByLabelText("Email"), "user@example.com");
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Login" }));

  await waitFor(() => expect(mockLogin).toHaveBeenCalled());
  expect(toast.error).toHaveBeenCalledWith("Denied", { id: "auth-login-error" });
  expect(mockPush).not.toHaveBeenCalled();
});

test("marks and focuses the first invalid login field while emitting one summary toast", async () => {
  const user = userEvent.setup();
  render(<LoginForm />);

  await user.click(screen.getByRole("button", { name: "Login" }));

  expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Email")).toHaveFocus();
  expect(toast.error).toHaveBeenCalledWith("2 fields need attention. Email: Please enter both email and password.");
  expect(toast.error).toHaveBeenCalledTimes(1);
});

test("reports and focuses the only missing login field", async () => {
  const user = userEvent.setup();
  render(<LoginForm />);

  await user.type(screen.getByLabelText("Email"), "user@example.com");
  await user.click(screen.getByRole("button", { name: "Login" }));

  expect(toast.error).toHaveBeenCalledWith("Missing fields", { description: "Please enter both email and password." });
  expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "false");
  expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Password")).toHaveFocus();
});

test("deduplicates login submission and ignores its result after unmount", async () => {
  const user = userEvent.setup();
  let resolveLogin;
  mockLogin.mockReturnValueOnce(new Promise((resolve) => {
    resolveLogin = resolve;
  }));
  const { unmount } = render(<LoginForm />);
  await user.type(screen.getByLabelText("Email"), "user@example.com");
  await user.type(screen.getByLabelText("Password"), "password");
  const submit = screen.getByRole("button", { name: "Login" });

  act(() => {
    submitTwiceBeforeReactFlush(submit);
  });

  expect(mockLogin).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => resolveLogin({ success: true }));
  expect(mockPush).not.toHaveBeenCalled();
});

test("uses the dark logo in password-reset mode", () => {
  mockTheme = "dark";
  mockResolvedTheme = "dark";
  render(<LoginForm isResetMode resetToken="token-3" />);
  expect(screen.getByRole("img", { name: "Defy" })).toHaveAttribute("data-src", "/logo_text_dark.png");
});

test.each([["light", "/logo_text.png"], ["dark", "/logo_text_dark.png"]])("uses the resolved %s logo when the system theme is selected", (resolvedTheme, logo) => {
  mockTheme = "system";
  mockResolvedTheme = resolvedTheme;
  render(<LoginForm />);
  expect(screen.getByRole("img", { name: "Defy" })).toHaveAttribute("data-src", logo);
});

test("validates forgot password then sends a valid request", async () => {
  const user = userEvent.setup();
  forgotPassword.mockResolvedValue({});
  render(<LoginForm />);
  await user.click(screen.getByRole("button", { name: /forgot password/i }));
  expect(screen.getByLabelText("Email", { selector: "#forgot-email" })).toHaveAttribute("placeholder", "user@example.com");
  fireEvent.submit(screen.getByRole("button", { name: /send reset link/i }));
  expect(toast.error).toHaveBeenCalledWith("Missing email", expect.any(Object));
  await user.type(screen.getByLabelText("Email", { selector: "#forgot-email" }), "invalid");
  await user.click(screen.getByRole("button", { name: /send reset link/i }));
  expect(toast.error).toHaveBeenCalledWith("Invalid email", expect.any(Object));
  await user.clear(screen.getByLabelText("Email", { selector: "#forgot-email" }));
  await user.type(screen.getByLabelText("Email", { selector: "#forgot-email" }), "user@example.com");
  await user.click(screen.getByRole("button", { name: /send reset link/i }));
  await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith("user@example.com"));
  expect(toast.success).toHaveBeenCalled();
});

test("reports forgot-password API errors and cancels", async () => {
  const user = userEvent.setup();
  forgotPassword.mockRejectedValue(new Error("Unavailable"));
  render(<LoginForm />);
  await user.click(screen.getByRole("button", { name: /forgot password/i }));
  await user.type(screen.getByLabelText("Email", { selector: "#forgot-email" }), "user@example.com");
  await user.click(screen.getByRole("button", { name: /send reset link/i }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't send reset link", { description: "Unavailable" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test.each(["resolve", "reject"])("deduplicates forgot-password submission and ignores a stale %s after closing", async (outcome) => {
  const user = userEvent.setup();
  let settleRequest;
  forgotPassword.mockReturnValueOnce(new Promise((resolve, reject) => {
    settleRequest = outcome === "resolve" ? resolve : reject;
  }));
  render(<LoginForm />);
  await user.click(screen.getByRole("button", { name: /forgot password/i }));
  await user.type(screen.getByLabelText("Email", { selector: "#forgot-email" }), "user@example.com");
  const submit = screen.getByRole("button", { name: /send reset link/i });

  act(() => {
    submitTwiceBeforeReactFlush(submit);
  });

  expect(forgotPassword).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  toast.error.mockClear();
  toast.success.mockClear();
  await act(async () => settleRequest(outcome === "resolve" ? {} : new Error("Unavailable")));
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});

test("validates reset passwords and completes reset", async () => {
  const user = userEvent.setup();
  resetPassword.mockResolvedValue({});
  render(<LoginForm isResetMode resetToken="token-1" />);
  expect(screen.getByLabelText("New Password")).toHaveAttribute("autocomplete", "new-password");
  expect(screen.getByLabelText("Confirm Password")).toHaveAttribute("autocomplete", "new-password");
  expect(screen.getByLabelText("New Password")).toHaveAttribute("placeholder", "Enter a new password");
  expect(screen.getByLabelText("Confirm Password")).toHaveAttribute("placeholder", "Confirm the new password");
  fireEvent.submit(screen.getByRole("button", { name: "Reset Password" }));
  expect(toast.error).toHaveBeenCalledWith("2 fields need attention. New Password: Please enter and confirm your new password.");
  await user.type(screen.getByLabelText("New Password"), "short");
  await user.type(screen.getByLabelText("Confirm Password"), "other");
  await user.click(screen.getByRole("button", { name: "Reset Password" }));
  expect(toast.error).toHaveBeenCalledWith("Passwords do not match");
  await user.clear(screen.getByLabelText("Confirm Password"));
  await user.type(screen.getByLabelText("Confirm Password"), "short");
  await user.click(screen.getByRole("button", { name: "Reset Password" }));
  expect(toast.error).toHaveBeenCalledWith("Password must be at least 8 characters");
  await user.clear(screen.getByLabelText("New Password"));
  await user.clear(screen.getByLabelText("Confirm Password"));
  await user.type(screen.getByLabelText("New Password"), "long-password");
  await user.type(screen.getByLabelText("Confirm Password"), "long-password");
  await user.click(screen.getByRole("button", { name: "Reset Password" }));
  await waitFor(() => expect(resetPassword).toHaveBeenCalledWith("token-1", "long-password"));
  expect(mockPush).toHaveBeenCalledWith("/login");
});

test("reports reset API errors", async () => {
  const user = userEvent.setup();
  resetPassword.mockRejectedValue(new Error("Expired"));
  render(<LoginForm isResetMode resetToken="token-2" />);
  await user.type(screen.getByLabelText("New Password"), "long-password");
  await user.type(screen.getByLabelText("Confirm Password"), "long-password");
  await user.click(screen.getByRole("button", { name: "Reset Password" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't reset password", { description: "Expired" }));
});

test("reports and focuses the only missing reset field", async () => {
  const user = userEvent.setup();
  render(<LoginForm isResetMode resetToken="token-4" />);
  await user.type(screen.getByLabelText("New Password"), "long-password");

  await user.click(screen.getByRole("button", { name: "Reset Password" }));

  expect(toast.error).toHaveBeenCalledWith("Missing fields", { description: "Please enter and confirm your new password." });
  expect(screen.getByLabelText("New Password")).toHaveAttribute("aria-invalid", "false");
  expect(screen.getByLabelText("Confirm Password")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Confirm Password")).toHaveFocus();
});

test.each(["resolve", "reject"])("deduplicates reset submission and ignores a stale %s after unmount", async (outcome) => {
  const user = userEvent.setup();
  let settleRequest;
  resetPassword.mockReturnValueOnce(new Promise((resolve, reject) => {
    settleRequest = outcome === "resolve" ? resolve : reject;
  }));
  const { unmount } = render(<LoginForm isResetMode resetToken="token-stale" />);
  await user.type(screen.getByLabelText("New Password"), "long-password");
  await user.type(screen.getByLabelText("Confirm Password"), "long-password");
  const submit = screen.getByRole("button", { name: "Reset Password" });

  act(() => {
    submitTwiceBeforeReactFlush(submit);
  });

  expect(resetPassword).toHaveBeenCalledTimes(1);
  unmount();
  toast.error.mockClear();
  toast.success.mockClear();
  await act(async () => settleRequest(outcome === "resolve" ? {} : new Error("Expired")));
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});
