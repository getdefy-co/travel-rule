import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { InquiryDetailDialog } from "@/components/inquiry-detail-dialog";
import { decideTrpInquiry, getTrpInquiry } from "@/lib/api";

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
}));
jest.mock("@/lib/api", () => ({
  decideTrpInquiry: jest.fn(),
  getTrpInquiry: jest.fn(),
}));

const naturalPerson = {
  naturalPerson: {
    name: {
      nameIdentifier: [{
        primaryIdentifier: "Chrome Test",
        secondaryIdentifier: "Codex",
        naturalPersonNameIdentifierType: "LEGL",
      }],
    },
    geographicAddress: [{
      addressType: "GEOG",
      addressLine: ["Test Street 1"],
      townName: "Istanbul",
      country: "TR",
    }],
    nationalIdentification: {
      nationalIdentifier: "TR-123",
      nationalIdentifierType: "NIDN",
      countryOfIssue: "TR",
    },
    customerIdentification: "customer-1",
    dateAndPlaceOfBirth: {
      dateOfBirth: "1990-01-01",
      placeOfBirth: "Istanbul",
    },
    countryOfResidence: "TR",
  },
  accountNumber: ["originator-account"],
};

const legalPerson = {
  legalPerson: {
    name: {
      nameIdentifier: [{
        legalPersonName: "Defy Test Beneficiary",
        legalPersonNameIdentifierType: "LEGL",
      }],
    },
    geographicAddress: [{
      addressType: "BIZZ",
      addressLine: ["Market Street 2"],
      townName: "London",
      country: "GB",
    }],
    nationalIdentification: {
      nationalIdentifier: "GB-456",
      nationalIdentifierType: "RAID",
      registrationAuthority: "GB-RA",
    },
    customerIdentification: "legal-customer-1",
    countryOfRegistration: "GB",
  },
  accountNumber: ["beneficiary-account"],
};

const createInquiry = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  protocol: "TRP",
  direction: "inbound",
  state: "pending",
  asset: { dti: "4H95J0R2X" },
  amount: "12.50",
  expires_at: "2030-01-02T10:00:00.000Z",
  created_at: "2030-01-01T10:00:00.000Z",
  updated_at: "2030-01-01T10:00:00.000Z",
  ivms101: {
    originator: { originatorPerson: [naturalPerson] },
    beneficiary: { beneficiaryPerson: [legalPerson] },
    originatingVASP: { originatingVASP: { name: "Origin VASP" } },
  },
  ...overrides,
});

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

beforeEach(() => {
  jest.clearAllMocks();
  getTrpInquiry.mockResolvedValue(createInquiry());
  decideTrpInquiry.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    state: "approved",
    retryable: false,
  });
});

test("renders transfer metadata, every person summary, and the canonical IVMS JSON", async () => {
  render(<InquiryDetailDialog open inquiryId="11111111-1111-4111-8111-111111111111" onOpenChange={jest.fn()} onDecisionComplete={jest.fn()} />);

  const dialog = await screen.findByRole("dialog", { name: "Inquiry review" });
  expect(await within(dialog).findByText("Pending")).toHaveClass("border-amber-500/30", "bg-amber-500/10");
  expect(await within(dialog).findByText("Chrome Test Codex")).toBeInTheDocument();
  expect(within(dialog).getByText("Natural person")).toHaveClass("border-slate-500/30", "bg-slate-500/10");
  expect(within(dialog).getByText("Defy Test Beneficiary")).toBeInTheDocument();
  expect(within(dialog).getByText("originator-account")).toBeInTheDocument();
  expect(within(dialog).getByText("beneficiary-account")).toBeInTheDocument();
  expect(within(dialog).getByText("Test Street 1, Istanbul, TR")).toBeInTheDocument();
  expect(within(dialog).getByText("GB-456 (RAID)")).toBeInTheDocument();
  expect(within(dialog).getByText("legal-customer-1")).toBeInTheDocument();
  expect(within(dialog).getByText("4H95J0R2X")).toBeInTheDocument();
  expect(within(dialog).getByText(/"originatorPerson"/)).toBeInTheDocument();
});

test("shows an awaiting state and no decision controls for records without IVMS data", async () => {
  getTrpInquiry.mockResolvedValue(createInquiry({ asset: null, amount: null, expires_at: null, ivms101: null }));
  render(<InquiryDetailDialog open inquiryId="11111111-1111-4111-8111-111111111111" onOpenChange={jest.fn()} onDecisionComplete={jest.fn()} />);

  expect(await screen.findByText("Awaiting inquiry data")).toBeInTheDocument();
  expect(screen.getAllByText("N/A").length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
});

test("validates and confirms a trimmed approval exactly once", async () => {
  const pendingDecision = deferred();
  decideTrpInquiry.mockReturnValue(pendingDecision.promise);
  const onOpenChange = jest.fn();
  const onDecisionComplete = jest.fn();
  const user = userEvent.setup();
  render(<InquiryDetailDialog open inquiryId="11111111-1111-4111-8111-111111111111" onOpenChange={onOpenChange} onDecisionComplete={onDecisionComplete} />);

  await user.click(await screen.findByRole("button", { name: "Approve" }));
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Payment address is required."));
  expect(screen.queryByText("Payment address is required.")).not.toBeInTheDocument();

  await user.type(screen.getByRole("textbox", { name: "Payment address" }), "  bc1qapproved  ");
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  expect(screen.getByText("Approve this inquiry using payment address bc1qapproved?")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("textbox", { name: "Payment address" })).toHaveValue("  bc1qapproved  ");
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  const confirm = screen.getByRole("button", { name: "Confirm approval" });
  await user.dblClick(confirm);

  expect(decideTrpInquiry).toHaveBeenCalledTimes(1);
  expect(decideTrpInquiry).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", {
    decision: "approved",
    payment_address: "bc1qapproved",
  });
  expect(confirm).toBeDisabled();

  pendingDecision.resolve({ id: "11111111-1111-4111-8111-111111111111", state: "approved", retryable: false });
  await waitFor(() => expect(onDecisionComplete).toHaveBeenCalledTimes(1));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(toast.success).toHaveBeenCalledWith("Inquiry approved.");
});

test("reports a durable rejected decision whose peer delivery is pending", async () => {
  decideTrpInquiry.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    state: "rejected",
    retryable: true,
  });
  const onOpenChange = jest.fn();
  const onDecisionComplete = jest.fn();
  const user = userEvent.setup();
  render(<InquiryDetailDialog open inquiryId="11111111-1111-4111-8111-111111111111" onOpenChange={onOpenChange} onDecisionComplete={onDecisionComplete} />);

  await user.click(await screen.findByRole("button", { name: "Reject" }));
  await user.type(screen.getByRole("textbox", { name: "Rejection reason" }), "  Unable to verify beneficiary  ");
  await user.click(screen.getByRole("button", { name: "Review rejection" }));
  expect(screen.getByText("Reject this inquiry because “Unable to verify beneficiary”?")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Confirm rejection" }));

  await waitFor(() => expect(decideTrpInquiry).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", {
    decision: "rejected",
    reason: "Unable to verify beneficiary",
  }));
  expect(toast.warning).toHaveBeenCalledWith("Decision saved. Peer delivery is pending; no dashboard retry is available.");
  expect(onDecisionComplete).toHaveBeenCalledTimes(1);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("refreshes the open detail and parent list after a decision conflict", async () => {
  const conflict = Object.assign(new Error("Inquiry is no longer pending"), { status: 409 });
  getTrpInquiry
    .mockResolvedValueOnce(createInquiry())
    .mockResolvedValueOnce(createInquiry({ state: "rejected" }));
  decideTrpInquiry.mockRejectedValue(conflict);
  const onOpenChange = jest.fn();
  const onDecisionComplete = jest.fn();
  const user = userEvent.setup();
  render(<InquiryDetailDialog open inquiryId="11111111-1111-4111-8111-111111111111" onOpenChange={onOpenChange} onDecisionComplete={onDecisionComplete} />);

  await user.click(await screen.findByRole("button", { name: "Reject" }));
  await user.type(screen.getByRole("textbox", { name: "Rejection reason" }), "Conflict test");
  await user.click(screen.getByRole("button", { name: "Review rejection" }));
  await user.click(screen.getByRole("button", { name: "Confirm rejection" }));

  await waitFor(() => expect(getTrpInquiry).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("Rejected")).toBeInTheDocument();
  expect(onDecisionComplete).toHaveBeenCalledTimes(1);
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  expect(toast.error).toHaveBeenCalledWith("This inquiry changed while you were reviewing it. The latest state is shown.");
});

test("shows detail errors, retries, and ignores a stale response after the inquiry changes", async () => {
  const oldRequest = deferred();
  getTrpInquiry
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(createInquiry())
    .mockReturnValueOnce(oldRequest.promise)
    .mockResolvedValueOnce(createInquiry({
      id: "22222222-2222-4222-8222-222222222222",
      amount: "99.00",
    }));
  const user = userEvent.setup();
  const { rerender } = render(<InquiryDetailDialog open inquiryId="11111111-1111-4111-8111-111111111111" onOpenChange={jest.fn()} onDecisionComplete={jest.fn()} />);

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not load inquiry details."));
  expect(screen.queryByText("Could not load inquiry details.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry details" }));
  expect(await screen.findByText("12.50")).toBeInTheDocument();

  rerender(<InquiryDetailDialog open inquiryId="33333333-3333-4333-8333-333333333333" onOpenChange={jest.fn()} onDecisionComplete={jest.fn()} />);
  await waitFor(() => expect(getTrpInquiry).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333"));
  rerender(<InquiryDetailDialog open inquiryId="22222222-2222-4222-8222-222222222222" onOpenChange={jest.fn()} onDecisionComplete={jest.fn()} />);
  expect(await screen.findByText("99.00")).toBeInTheDocument();
  oldRequest.resolve(createInquiry({ amount: "1.00" }));
  await waitFor(() => expect(screen.queryByText("1.00")).not.toBeInTheDocument());
});

test("renders safe fallbacks for sparse people and empty person collections", async () => {
  getTrpInquiry.mockResolvedValue(createInquiry({
    state: "approved",
    ivms101: {
      originator: {
        originatorPerson: [
          {},
          {
            naturalPerson: {
              name: { nameIdentifier: [{ primaryIdentifier: "Single" }] },
              geographicAddress: [{}],
              nationalIdentification: { nationalIdentifier: "ID-ONLY" },
            },
          },
        ],
      },
      beneficiary: { beneficiaryPerson: [] },
    },
  }));
  render(<InquiryDetailDialog open inquiryId="11111111-1111-4111-8111-111111111111" onOpenChange={jest.fn()} onDecisionComplete={jest.fn()} />);

  expect(await screen.findByText("Single")).toBeInTheDocument();
  expect(screen.getByText("ID-ONLY")).toBeInTheDocument();
  expect(screen.getAllByText("N/A").length).toBeGreaterThan(5);
  expect(within(screen.getByRole("region", { name: "Beneficiaries" })).getByText("N/A")).toBeInTheDocument();
});

test("supports cancel, back, generic decision failure, and explicit close paths", async () => {
  decideTrpInquiry.mockRejectedValue(new Error("offline"));
  const onOpenChange = jest.fn();
  const user = userEvent.setup();
  const { rerender } = render(<InquiryDetailDialog open inquiryId="11111111-1111-4111-8111-111111111111" onOpenChange={onOpenChange} onDecisionComplete={jest.fn()} />);

  await user.click(await screen.findByRole("button", { name: "Approve" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Reject" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Reject" }));
  await user.type(screen.getByRole("textbox", { name: "Rejection reason" }), "Retry test");
  await user.click(screen.getByRole("button", { name: "Review rejection" }));
  await user.click(screen.getByRole("button", { name: "Back" }));
  await user.click(screen.getByRole("button", { name: "Review rejection" }));
  await user.click(screen.getByRole("button", { name: "Confirm rejection" }));

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not save the inquiry decision."));
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);

  rerender(<InquiryDetailDialog open={false} inquiryId={null} onOpenChange={onOpenChange} onDecisionComplete={jest.fn()} />);
  expect(screen.queryByRole("dialog", { name: "Inquiry review" })).not.toBeInTheDocument();
});


test.each(["resolve", "reject"])("ignores a decision %s after the review closes", async (outcome) => {
  let finish;
  decideTrpInquiry.mockReturnValueOnce(new Promise((resolve, reject) => { finish = outcome === "resolve" ? resolve : reject; }));
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  const onDecisionComplete = jest.fn();
  const { unmount } = render(<InquiryDetailDialog open inquiryId="11111111-1111-4111-8111-111111111111" onOpenChange={onOpenChange} onDecisionComplete={onDecisionComplete} />);
  await user.click(await screen.findByRole("button", { name: "Approve" }));
  await user.type(screen.getByLabelText("Payment address"), "payment-address");
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  await user.click(screen.getByRole("button", { name: "Confirm approval" }));
  unmount();
  await act(async () => { finish(new Error("late response")); });
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(onDecisionComplete).not.toHaveBeenCalled();
});

test("allows another decision after a conflict refresh leaves the inquiry pending", async () => {
  decideTrpInquiry.mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 }));
  const user = userEvent.setup();
  render(<InquiryDetailDialog open inquiryId="11111111-1111-4111-8111-111111111111" onOpenChange={jest.fn()} onDecisionComplete={jest.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Approve" }));
  await user.type(screen.getByLabelText("Payment address"), "payment-address");
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  await user.click(screen.getByRole("button", { name: "Confirm approval" }));
  await user.click(await screen.findByRole("button", { name: "Approve" }));
  await user.click(screen.getByRole("button", { name: "Review approval" }));
  expect(screen.getByRole("button", { name: "Confirm approval" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
});
