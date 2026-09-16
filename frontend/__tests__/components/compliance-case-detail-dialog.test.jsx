import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { ComplianceCaseDetailDialog } from "@/components/compliance-case-detail-dialog";
import * as api from "@/lib/api";

jest.mock("@/lib/api", () => ({ decideComplianceCase: jest.fn(), getComplianceCase: jest.fn() }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn(), dismiss: jest.fn() } }));

let mockAuth = { user: { role: "admin" } };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockAuth }));

const caseId = "10000000-0000-4000-8000-000000000001";
const createCase = (overrides = {}) => ({
  exchange: { id: "30000000-0000-4000-8000-000000000001", state: "completed" },
  external_id: "withdrawal-42",
  id: caseId,
  required_approval: "compliance_reviewer",
  state: "pending",
  transfer_id: "20000000-0000-4000-8000-000000000001",
  transfer_state: "on_hold",
  version: 0,
  ...overrides,
});

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const renderDialog = (props = {}) => {
  const onDecisionComplete = jest.fn();
  const onOpenChange = jest.fn();
  const view = render(
    <ComplianceCaseDetailDialog
      caseId={caseId}
      onDecisionComplete={onDecisionComplete}
      onOpenChange={onOpenChange}
      open
      {...props}
    />,
  );
  return { ...view, onDecisionComplete, onOpenChange };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { user: { role: "admin" } };
  api.getComplianceCase.mockResolvedValue(createCase());
  api.decideComplianceCase.mockResolvedValue({ case_state: "approved", transfer_state: "ready", version: 1 });
});

test("reviews and confirms an approval before persisting it", async () => {
  const user = userEvent.setup();
  const { onDecisionComplete, onOpenChange } = renderDialog();

  expect(await screen.findByRole("dialog", { name: "Compliance case review" })).toBeInTheDocument();
  expect(await screen.findByText("Pending")).toHaveClass("border-amber-500/30", "bg-amber-500/10");
  await user.click(await screen.findByRole("button", { name: "Approve" }));
  await user.type(screen.getByLabelText("Decision reason"), "  Evidence verified  ");
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  expect(api.decideComplianceCase).not.toHaveBeenCalled();
  expect(screen.getByText("Approve this compliance case because “Evidence verified”?")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Confirm approval" }));

  await waitFor(() => expect(api.decideComplianceCase).toHaveBeenCalledWith(caseId, {
    decision: "approved",
    expected_version: 0,
    reason: "Evidence verified",
  }));
  expect(toast.success).toHaveBeenCalledWith("Compliance case approved.");
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(onDecisionComplete).toHaveBeenCalledTimes(1);
});

test("labels a reviewer approval that advances an approver-gated case", async () => {
  const user = userEvent.setup();
  mockAuth = { user: { role: "compliance_reviewer" } };
  api.getComplianceCase.mockResolvedValueOnce(createCase({ required_approval: "compliance_approver" }));
  api.decideComplianceCase.mockResolvedValueOnce({ case_state: "escalated", transfer_state: "on_hold", version: 1 });
  renderDialog();

  await user.click(await screen.findByRole("button", { name: "Record reviewer approval" }));
  await user.type(screen.getByLabelText("Decision reason"), "Independent review complete");
  await user.click(screen.getByRole("button", { name: "Review reviewer approval" }));
  await user.click(screen.getByRole("button", { name: "Confirm reviewer approval" }));

  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Reviewer approval recorded. The case now requires final approval."));
  expect(api.decideComplianceCase).toHaveBeenCalledWith(caseId, {
    decision: "approved",
    expected_version: 0,
    reason: "Independent review complete",
  });
});

test.each([
  ["Reject", "Review rejection", "Confirm rejection", "rejected", "Compliance case rejected."],
  ["Escalate", "Review escalation", "Confirm escalation", "escalated", "Compliance case escalated."],
])("confirms the %s action", async (action, review, confirm, decision, successMessage) => {
  const user = userEvent.setup();
  mockAuth = { user: { role: "compliance_reviewer" } };
  api.decideComplianceCase.mockResolvedValueOnce({ case_state: decision, transfer_state: "on_hold", version: 1 });
  renderDialog();

  await user.click(await screen.findByRole("button", { name: action }));
  await user.type(screen.getByLabelText("Decision reason"), "Documented outcome");
  await user.click(screen.getByRole("button", { name: review }));
  await user.click(screen.getByRole("button", { name: confirm }));

  await waitFor(() => expect(api.decideComplianceCase).toHaveBeenCalledWith(caseId, {
    decision,
    expected_version: 0,
    reason: "Documented outcome",
  }));
  expect(toast.success).toHaveBeenCalledWith(successMessage);
});

test("requires a reason and prevents same-tick duplicate submissions", async () => {
  const user = userEvent.setup();
  const pendingDecision = deferred();
  api.decideComplianceCase.mockReturnValueOnce(pendingDecision.promise);
  renderDialog();

  await user.click(await screen.findByRole("button", { name: "Approve" }));
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A decision reason is required."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Decision reason"), "Approved evidence");
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  const confirm = screen.getByRole("button", { name: "Confirm approval" });
  fireEvent.click(confirm);
  fireEvent.click(confirm);

  expect(api.decideComplianceCase).toHaveBeenCalledTimes(1);
  pendingDecision.resolve({ case_state: "approved", transfer_state: "ready", version: 1 });
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Compliance case approved."));
});

test("navigates back from review stages and reports an explicit close", async () => {
  const user = userEvent.setup();
  const { onOpenChange } = renderDialog();

  await user.click(await screen.findByRole("button", { name: "Approve" }));
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Approve" }));
  await user.type(screen.getByLabelText("Decision reason"), "Reviewed evidence");
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByLabelText("Decision reason")).toHaveValue("Reviewed evidence");

  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("reloads the open detail and parent queue after a stale decision conflict", async () => {
  const user = userEvent.setup();
  api.getComplianceCase
    .mockResolvedValueOnce(createCase())
    .mockResolvedValueOnce(createCase({ state: "rejected", transfer_state: "returned", version: 1 }));
  api.decideComplianceCase.mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 }));
  const { onDecisionComplete, onOpenChange } = renderDialog();

  await user.click(await screen.findByRole("button", { name: "Approve" }));
  await user.type(screen.getByLabelText("Decision reason"), "Concurrent review");
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  await user.click(screen.getByRole("button", { name: "Confirm approval" }));

  await waitFor(() => expect(api.getComplianceCase).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Rejected")).toBeInTheDocument();
  expect(toast.error).toHaveBeenCalledWith("This case changed while you were reviewing it. The latest state is shown.");
  expect(onDecisionComplete).toHaveBeenCalledTimes(1);
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});

test("preserves the confirmation after a generic decision failure", async () => {
  const user = userEvent.setup();
  api.decideComplianceCase.mockRejectedValueOnce(new Error("offline"));
  renderDialog();

  await user.click(await screen.findByRole("button", { name: "Reject" }));
  await user.type(screen.getByLabelText("Decision reason"), "Unable to verify");
  await user.click(screen.getByRole("button", { name: "Review rejection" }));
  await user.click(screen.getByRole("button", { name: "Confirm rejection" }));

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not save the compliance decision."));
  expect(screen.getByText("Reject this compliance case because “Unable to verify”?")).toBeInTheDocument();
});

test("shows role-aware actions and no mutation controls for terminal cases", async () => {
  mockAuth = { user: { role: "compliance_approver" } };
  api.getComplianceCase.mockResolvedValueOnce(createCase({ required_approval: "compliance_approver" }));
  const { unmount } = renderDialog();

  await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("A reviewer approval is required before final approval.", expect.objectContaining({ duration: Infinity })));
  expect(screen.queryByText("A reviewer approval is required before final approval.")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  unmount();

  api.getComplianceCase.mockResolvedValueOnce(createCase({ state: "approved", transfer_state: "ready", version: 1 }));
  renderDialog();
  expect(await screen.findByText("Approved")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
});

test("shows a retryable detail error without loading a closed dialog", async () => {
  const user = userEvent.setup();
  api.getComplianceCase.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(createCase());
  const { rerender } = render(
    <ComplianceCaseDetailDialog caseId={caseId} onDecisionComplete={jest.fn()} onOpenChange={jest.fn()} open />,
  );

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not load the compliance case."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry case details" }));
  expect(await screen.findByText("withdrawal-42")).toBeInTheDocument();
  rerender(<ComplianceCaseDetailDialog caseId={null} onDecisionComplete={jest.fn()} onOpenChange={jest.fn()} open={false} />);
  expect(api.getComplianceCase).toHaveBeenCalledTimes(2);
});


test.each(["resolve", "reject"])("ignores a decision %s after the review closes", async (outcome) => {
  let finish;
  api.decideComplianceCase.mockReturnValueOnce(new Promise((resolve, reject) => { finish = outcome === "resolve" ? resolve : reject; }));
  const user = userEvent.setup();
  const { unmount, onOpenChange, onDecisionComplete } = renderDialog();
  await user.click(await screen.findByRole("button", { name: "Approve" }));
  await user.type(screen.getByLabelText("Decision reason"), "Verified evidence");
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  await user.click(screen.getByRole("button", { name: "Confirm approval" }));
  unmount();
  await act(async () => { finish(new Error("late response")); });
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(onDecisionComplete).not.toHaveBeenCalled();
});

test("allows another decision after a version conflict leaves the case pending", async () => {
  api.decideComplianceCase.mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 }));
  const user = userEvent.setup();
  renderDialog();
  await user.click(await screen.findByRole("button", { name: "Approve" }));
  await user.type(screen.getByLabelText("Decision reason"), "Verified evidence");
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  await user.click(screen.getByRole("button", { name: "Confirm approval" }));
  await user.click(await screen.findByRole("button", { name: "Approve" }));
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  expect(screen.getByRole("button", { name: "Confirm approval" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
});
