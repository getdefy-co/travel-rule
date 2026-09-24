import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { ComplianceCaseDashboard } from "@/components/compliance-case-dashboard";
import * as api from "@/lib/api";

jest.mock("@/lib/api", () => ({ decideComplianceCase: jest.fn(), getComplianceCase: jest.fn(), listComplianceCases: jest.fn() }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: "compliance_reviewer" } }) }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn(), dismiss: jest.fn() } }));

const caseId = "10000000-0000-4000-8000-000000000001";
const transferId = "20000000-0000-4000-8000-000000000001";
const item = {
  created_at: "2026-08-27T09:00:00.000Z",
  exchange: { connector: "native_trp", id: "30000000-0000-4000-8000-000000000001", state: "completed" },
  external_id: "withdrawal-42",
  id: caseId,
  required_approval: "compliance_reviewer",
  state: "pending",
  transfer_id: transferId,
  transfer_state: "on_hold",
  updated_at: "2026-08-27T10:00:00.000Z",
  version: 0,
};

beforeEach(() => {
  api.listComplianceCases.mockReset();
  api.listComplianceCases.mockResolvedValue({ data: [item], limit: 20, page: 1, total: 1 });
  api.getComplianceCase.mockReset();
  api.getComplianceCase.mockResolvedValue({ ...item, exchange: { id: item.exchange.id, state: "completed" } });
  api.decideComplianceCase.mockReset();
  api.decideComplianceCase.mockResolvedValue({ case_state: "approved", transfer_state: "ready", version: 1 });
});

test("lists, inspects, and decides a protocol-neutral compliance case", async () => {
  const user = userEvent.setup();
  render(<ComplianceCaseDashboard />);

  expect(await screen.findByText("withdrawal-42")).toBeInTheDocument();
  expect(screen.getByText("Pending")).toHaveClass("border-amber-500/30", "bg-amber-500/10");
  await user.click(screen.getByRole("button", { name: "Review" }));
  expect(await screen.findByRole("dialog", { name: "Compliance case review" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Approve" }));
  await user.type(screen.getByLabelText("Decision reason"), "Evidence verified in the VASP DMS.");
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  expect(api.decideComplianceCase).not.toHaveBeenCalled();
  expect(screen.getByText("Approve this compliance case because “Evidence verified in the VASP DMS.”?")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Confirm approval" }));

  await waitFor(() => expect(api.decideComplianceCase).toHaveBeenCalledWith(caseId, {
    decision: "approved",
    expected_version: 0,
    reason: "Evidence verified in the VASP DMS.",
  }));
});

test("shows a safe empty queue without leaking API details", async () => {
  api.listComplianceCases.mockResolvedValueOnce({ data: [], limit: 20, page: 1, total: 0 });
  render(<ComplianceCaseDashboard />);

  expect(await screen.findByText("No compliance cases match this filter.")).toBeInTheDocument();
});

test("reports queue and detail loading failures and supports a manual refresh", async () => {
  const user = userEvent.setup();
  api.listComplianceCases.mockRejectedValueOnce(new Error("Queue unavailable"));
  render(<ComplianceCaseDashboard />);

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Queue unavailable"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Refresh cases" }));
  expect(await screen.findByText("withdrawal-42")).toBeInTheDocument();

  api.getComplianceCase.mockRejectedValueOnce(new Error("Case unavailable"));
  await user.click(screen.getByRole("button", { name: "Review" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not load the compliance case."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("requires a reason and reports decision failures", async () => {
  const user = userEvent.setup();
  render(<ComplianceCaseDashboard />);

  await user.click(await screen.findByRole("button", { name: "Review" }));
  await user.click(screen.getByRole("button", { name: "Approve" }));
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A decision reason is required."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(api.decideComplianceCase).not.toHaveBeenCalled();

  api.decideComplianceCase.mockRejectedValueOnce(new Error("Decision conflict"));
  await user.type(screen.getByLabelText("Decision reason"), "Concurrent review detected.");
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  await user.click(screen.getByRole("button", { name: "Confirm approval" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not save the compliance decision."));
});

test.each([
  ["Escalate", "escalated"],
  ["Reject", "rejected"],
])("submits the %s decision", async (buttonName, decision) => {
  const user = userEvent.setup();
  api.decideComplianceCase.mockResolvedValueOnce({ case_state: decision, transfer_state: "on_hold", version: 1 });
  render(<ComplianceCaseDashboard />);

  await user.click(await screen.findByRole("button", { name: "Review" }));
  await user.click(screen.getByRole("button", { name: buttonName }));
  await user.type(screen.getByLabelText("Decision reason"), "Documented review outcome.");
  await user.click(screen.getByRole("button", { name: decision === "rejected" ? "Review rejection" : "Review escalation" }));
  await user.click(screen.getByRole("button", { name: decision === "rejected" ? "Confirm rejection" : "Confirm escalation" }));

  await waitFor(() => expect(api.decideComplianceCase).toHaveBeenCalledWith(caseId, {
    decision,
    expected_version: 0,
    reason: "Documented review outcome.",
  }));
});


test("changes state filters and ignores the previous queue failure", async () => {
  let reject;
  api.listComplianceCases.mockReturnValueOnce(new Promise((resolve, rejectPromise) => { reject = rejectPromise; }));
  const user = userEvent.setup();
  render(<ComplianceCaseDashboard />);
  await waitFor(() => expect(api.listComplianceCases).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("combobox", { name: "Case state filter" }));
  await user.click(screen.getByRole("option", { name: "Approved", exact: true }));
  await waitFor(() => expect(api.listComplianceCases).toHaveBeenLastCalledWith({ state: "approved" }));
  await act(async () => { reject(new Error("stale failure")); });
  expect(toast.error).not.toHaveBeenCalled();
});
