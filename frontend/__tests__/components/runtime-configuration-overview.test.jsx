import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { RuntimeConfigurationOverview } from "@/components/runtime-configuration-overview";
import { getRuntimeConfiguration } from "@/lib/api";

jest.mock("@/lib/api", () => ({ getRuntimeConfiguration: jest.fn() }));
jest.mock("sonner", () => ({ toast: { dismiss: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const runtime = {
  encryption: { active_key_id: "primary", retired_key_count: 2 },
  identity: { lei: "00000000000000000000", name: "Example VASP", public_base_url: "https://trp.example.invalid:3001" },
  integrations: { email_mode: "smtp", oidc_enabled: true },
  mode: "trp",
  operations: { email_fallback_delay_minutes: 30, http_timeout_ms: 10000, retention_days: 1825, token_ttl_seconds: 86400 },
};

beforeEach(() => {
  jest.clearAllMocks();
  getRuntimeConfiguration.mockResolvedValue(runtime);
});

test("renders the safe TRP runtime projection", async () => {
  render(<RuntimeConfigurationOverview />);

  expect(await screen.findByRole("heading", { name: "Runtime Overview" })).toBeInTheDocument();
  expect(await screen.findByText("Example VASP")).toBeInTheDocument();
  expect(screen.getByText("TRP")).toHaveClass("border-blue-500/30", "bg-blue-500/10");
  expect(screen.getByText("https://trp.example.invalid:3001")).toBeInTheDocument();
  expect(screen.getByText("1,825 days")).toBeInTheDocument();
  expect(screen.getByText("86,400 seconds")).toBeInTheDocument();
  expect(screen.getByText("10,000 ms")).toBeInTheDocument();
  expect(screen.getByText("30 minutes")).toBeInTheDocument();
  expect(screen.getByText("primary")).toBeInTheDocument();
  expect(screen.getByText("2 retired keys")).toBeInTheDocument();
  expect(screen.getByText("SMTP")).toHaveClass("border-emerald-500/30", "bg-emerald-500/10");
  expect(screen.getByText("Enabled")).toHaveClass("border-emerald-500/30", "bg-emerald-500/10");
});

test("renders auth mode without TRP-only sections", async () => {
  getRuntimeConfiguration.mockResolvedValueOnce({
    encryption: null,
    identity: null,
    integrations: { email_mode: "disabled", oidc_enabled: false },
    mode: "auth",
    operations: null,
  });

  render(<RuntimeConfigurationOverview />);

  expect(await screen.findByText("AUTH")).toHaveClass("border-slate-500/30", "bg-slate-500/10");
  await waitFor(() => expect(toast.info).toHaveBeenCalledWith("TRP runtime details are unavailable in auth-only mode.", { id: "runtime-auth-only-notice" }));
  expect(screen.queryByText("TRP runtime details are unavailable in auth-only mode.")).not.toBeInTheDocument();
  expect(screen.getAllByText("Disabled")).toHaveLength(2);
});

test("owns its loading error and retry state", async () => {
  const user = userEvent.setup();
  getRuntimeConfiguration.mockRejectedValueOnce(new Error("offline"));
  render(<RuntimeConfigurationOverview />);

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not load runtime configuration."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry runtime overview" }));
  expect(await screen.findByText("Example VASP")).toBeInTheDocument();
  expect(getRuntimeConfiguration).toHaveBeenCalledTimes(2);
});

test("cancels deferred work when unmounted", async () => {
  const { unmount } = render(<RuntimeConfigurationOverview />);
  unmount();
  await act(async () => Promise.resolve());
  expect(getRuntimeConfiguration).not.toHaveBeenCalled();

  let resolveRequest;
  getRuntimeConfiguration.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
  const { unmount: unmountPending } = render(<RuntimeConfigurationOverview />);
  await waitFor(() => expect(getRuntimeConfiguration).toHaveBeenCalledTimes(1));
  unmountPending();
  await act(async () => resolveRequest(runtime));
});
