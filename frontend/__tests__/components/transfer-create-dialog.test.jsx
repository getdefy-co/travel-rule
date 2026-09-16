import { toast } from "sonner";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TransferCreateDialog } from "@/components/transfer-create-dialog";
import { createTrpTransfer } from "@/lib/api";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn(), info: jest.fn(), dismiss: jest.fn() } }));

jest.mock("@/lib/api", () => ({ createTrpTransfer: jest.fn() }));

let mockTransferStepperProps;
jest.mock("@/components/transfer-stepper", () => {
  const React = jest.requireActual("react");
  const { TransferStepper } = jest.requireActual("@/components/transfer-stepper");
  return {
    TransferStepper: function MockTransferStepper(props) {
      mockTransferStepperProps = props;
      return React.createElement(TransferStepper, props);
    },
  };
});

beforeEach(() => {
  jest.resetAllMocks();
  createTrpTransfer.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", state: "pending", retryable: false });
});

const chooseOption = async (user, dialog, label, option) => {
  await user.click(within(dialog).getByRole("combobox", { name: label }));
  await user.click(screen.getByRole("option", { name: option }));
};

const fillTransfer = (dialog, { amount = "25", dti = "4H95J0R2X", travelAddress = "ta.example/address" } = {}) => {
  fireEvent.change(within(dialog).getByLabelText("Travel Address"), { target: { value: travelAddress } });
  fireEvent.change(within(dialog).getByLabelText("Asset DTI"), { target: { value: dti } });
  fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: amount } });
};

const fillOriginator = (dialog, { customerNumber = "originator-1", name = "Smith" } = {}) => {
  fireEvent.change(within(dialog).getByLabelText("Originator primary identifier 1"), { target: { value: name } });
  fireEvent.change(within(dialog).getByLabelText(/Originator customer (number|identification)/), { target: { value: customerNumber } });
};

const fillBeneficiary = (dialog, { customerNumber = "beneficiary-1", name = "Example Ltd" } = {}) => {
  fireEvent.change(within(dialog).getByLabelText("Beneficiary legal name 1"), { target: { value: name } });
  fireEvent.change(within(dialog).getByLabelText(/Beneficiary customer (number|identification)/), { target: { value: customerNumber } });
};

const next = async (user, dialog) => user.click(within(dialog).getByRole("button", { name: "Next" }));

const advanceToMetadata = async (user, dialog) => {
  fillTransfer(dialog);
  await next(user, dialog);
  fillOriginator(dialog);
  await next(user, dialog);
  fillBeneficiary(dialog);
  await next(user, dialog);
  await next(user, dialog);
};

test("renders an accessible sequential stepper without tab roles and validates the active step", async () => {
  const user = userEvent.setup();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  expect(within(dialog).getByRole("form", { name: "New Transfer" })).toHaveClass("min-w-0", "w-full");
  expect(within(dialog).getByRole("navigation", { name: "Transfer creation progress" })).toBeInTheDocument();
  expect(within(dialog).queryAllByRole("tab")).toHaveLength(0);
  expect(within(dialog).getByRole("button", { name: "Transfer" })).toHaveAttribute("aria-current", "step");
  expect(within(dialog).getByRole("button", { name: "Originator" })).toBeDisabled();
  expect(within(dialog).queryByLabelText("IVMS 101 JSON")).not.toBeInTheDocument();
  for (const input of within(dialog).getAllByRole("textbox")) {
    expect(input).toHaveAttribute("placeholder", expect.stringMatching(/\S/));
  }

  await next(user, dialog);

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/fields? need(?:s)? attention\./)));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Transfer" })).toHaveAttribute("aria-current", "step");
  expect(within(dialog).getByLabelText("Travel Address")).toHaveAttribute("aria-invalid", "true");
  expect(toast.error).toHaveBeenCalledWith("3 fields need attention. Travel Address: This field is required.");
  expect(within(dialog).getByLabelText("Travel Address")).toHaveFocus();
  expect(within(dialog).getByLabelText("Travel Address")).not.toHaveAttribute("aria-describedby");
  expect(createTrpTransfer).not.toHaveBeenCalled();
});

test("maps the default 2020 person fields and submits the exact management payload", async () => {
  const user = userEvent.setup();
  const onComplete = jest.fn();
  const onOpenChange = jest.fn();
  render(<TransferCreateDialog onComplete={onComplete} onOpenChange={onOpenChange} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  fillTransfer(dialog, { amount: "500", dti: " 4H95J0R2X ", travelAddress: " ta.example/address " });
  await next(user, dialog);
  fillOriginator(dialog, { customerNumber: " customer-1 ", name: " Smith " });
  fireEvent.change(within(dialog).getByLabelText("Originator secondary identifier 1"), { target: { value: " Alice " } });
  await user.click(within(dialog).getByRole("button", { name: "Add person account number" }));
  fireEvent.change(within(dialog).getByLabelText("Originator person account number 1"), { target: { value: " person-account-1 " } });
  await next(user, dialog);
  fillBeneficiary(dialog, { customerNumber: " customer-2 ", name: " Example Ltd " });
  await next(user, dialog);
  await next(user, dialog);
  await user.click(within(dialog).getByRole("button", { name: "Create transfer" }));

  await waitFor(() => expect(createTrpTransfer).toHaveBeenCalledWith({
    amount: "500",
    asset: { dti: "4H95J0R2X" },
    travel_address: "ta.example/address",
    ivms101: {
      originator: {
        originatorPersons: [{
          accountNumber: ["person-account-1"],
          naturalPerson: {
            name: { nameIdentifier: [{ primaryIdentifier: "Smith", secondaryIdentifier: "Alice", nameIdentifierType: "LEGL" }] },
            customerNumber: "customer-1",
          },
        }],
      },
      beneficiary: {
        beneficiaryPersons: [{
          legalPerson: {
            name: { nameIdentifier: [{ legalPersonName: "Example Ltd", legalPersonNameIdentifierType: "LEGL" }] },
            customerNumber: "customer-2",
          },
        }],
      },
    },
  }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(onComplete).toHaveBeenCalledTimes(1);
});

test("uses step-level validation for 2023 optional sections and final metadata", async () => {
  const user = userEvent.setup();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  fillTransfer(dialog, { amount: "0" });
  await chooseOption(user, dialog, "IVMS101 version", "IVMS101.2023");
  await next(user, dialog);
  expect(within(dialog).getByRole("button", { name: "Transfer" })).toHaveAttribute("aria-current", "step");

  fireEvent.change(within(dialog).getByLabelText("Amount"), { target: { value: "25" } });
  await next(user, dialog);
  await user.click(within(dialog).getByRole("button", { name: "Add originator address" }));
  expect(within(dialog).getByLabelText("Originator address type 1")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Remove originator address 1" }));
  fillOriginator(dialog);
  await next(user, dialog);
  fillBeneficiary(dialog);
  await next(user, dialog);

  await user.click(within(dialog).getByRole("button", { name: "Add originating VASP" }));
  await user.click(within(dialog).getByRole("button", { name: "Add intermediary VASP" }));
  expect(within(dialog).getByLabelText("Intermediary VASP sequence 1")).toHaveValue(0);
  await next(user, dialog);
  expect(within(dialog).getByRole("button", { name: "VASPs & Path" })).toHaveAttribute("aria-current", "step");

  await user.click(within(dialog).getByRole("button", { name: "Remove Originating VASP" }));
  await user.click(within(dialog).getByRole("button", { name: "Remove intermediary VASP 1" }));
  await next(user, dialog);
  await user.click(within(dialog).getByRole("button", { name: "Add transliteration method" }));
  await user.click(within(dialog).getByRole("button", { name: "Create transfer" }));

  expect(within(dialog).getByRole("button", { name: "Metadata" })).toHaveAttribute("aria-current", "step");
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/fields? need(?:s)? attention\./)));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(createTrpTransfer).not.toHaveBeenCalled();
});

test("requires an explicit create action after navigating to metadata", async () => {
  const user = userEvent.setup();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  fillTransfer(dialog);
  await next(user, dialog);
  fillOriginator(dialog);
  await next(user, dialog);
  fillBeneficiary(dialog);
  await next(user, dialog);

  expect(within(dialog).getByRole("button", { name: "VASPs & Path" })).toHaveAttribute("aria-current", "step");
  expect(fireEvent.click(within(dialog).getByRole("button", { name: "Next" }))).toBe(false);

  expect(within(dialog).getByRole("button", { name: "Metadata" })).toHaveAttribute("aria-current", "step");
  expect(within(dialog).getByRole("button", { name: "Create transfer" })).toBeInTheDocument();
  expect(createTrpTransfer).not.toHaveBeenCalled();
});

test("supports previous and completed-step navigation, then invalidates later completion after edits", async () => {
  const user = userEvent.setup();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  fillTransfer(dialog);
  await next(user, dialog);
  fillOriginator(dialog);
  await next(user, dialog);
  expect(within(dialog).getByRole("button", { name: "Beneficiary" })).toHaveAttribute("aria-current", "step");

  await user.click(within(dialog).getByRole("button", { name: "Originator" }));
  expect(within(dialog).getByLabelText("Originator primary identifier 1")).toHaveValue("Smith");
  fireEvent.change(within(dialog).getByLabelText("Originator primary identifier 1"), { target: { value: "Jones" } });
  expect(within(dialog).getByRole("button", { name: "Beneficiary" })).toBeDisabled();

  await next(user, dialog);
  expect(within(dialog).getByRole("button", { name: "Beneficiary" })).toHaveAttribute("aria-current", "step");
  await user.click(within(dialog).getByRole("button", { name: "Previous" }));
  expect(within(dialog).getByLabelText("Originator primary identifier 1")).toHaveValue("Jones");
});

test("keeps identifier controls in a shared grid row when a label wraps", async () => {
  const user = userEvent.setup();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  fillTransfer(dialog);
  await next(user, dialog);
  await user.click(within(dialog).getByRole("button", { name: "Add originator person" }));

  const fieldGroups = within(dialog).getAllByRole("group");
  const identifierLabels = [
    "Originator person 2 primary identifier 1",
    "Originator person 2 secondary identifier 1",
  ];

  for (const label of identifierLabels) {
    const field = fieldGroups.find((group) => within(group).queryByLabelText(label));
    expect(field).toHaveClass("sm:grid", "sm:row-span-3", "sm:grid-rows-subgrid");
  }
});

test("keeps the birth section title and remove action in the same header row", async () => {
  const user = userEvent.setup();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  fillTransfer(dialog);
  await next(user, dialog);
  await user.click(within(dialog).getByRole("button", { name: "Add Originator birth details" }));

  const header = within(dialog).getByRole("group", { name: "Date and place of birth" });
  expect(header).toHaveClass("flex", "items-center", "justify-between");
  expect(within(header).getByRole("button", { name: "Remove Originator birth details" })).toBeInTheDocument();
});

test("keeps address and national identification titles beside their remove actions", async () => {
  const user = userEvent.setup();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  fillTransfer(dialog);
  await next(user, dialog);
  await user.click(within(dialog).getByRole("button", { name: "Add originator address" }));
  await user.click(within(dialog).getByRole("button", { name: "Add Originator national identification" }));

  const sections = [
    { label: "Originator address 1", remove: "Remove originator address 1" },
    { label: "National identification", remove: "Remove Originator national identification" },
  ];
  for (const section of sections) {
    const header = within(dialog).getByRole("group", { name: section.label });
    expect(header).toHaveClass("flex", "items-center", "justify-between");
    expect(within(header).getByRole("button", { name: section.remove })).toBeInTheDocument();
  }
});

test("updates editable natural-person names and identification", async () => {
  const user = userEvent.setup();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  fillTransfer(dialog);
  await next(user, dialog);
  fillOriginator(dialog);

  await user.click(within(dialog).getByRole("button", { name: "Add account number" }));
  await user.click(within(dialog).getByRole("button", { name: "Add account number" }));
  fireEvent.change(within(dialog).getByLabelText("Originator account number 2"), { target: { value: "ORIGINATOR-ACCOUNT-2" } });

  await user.click(within(dialog).getByRole("button", { name: "Add name" }));
  fireEvent.change(within(dialog).getByLabelText("Originator primary identifier 2"), { target: { value: "Alias" } });
  await chooseOption(user, dialog, "Name type 2", "ALIA");
  await user.click(within(dialog).getByRole("button", { name: "Remove name 2" }));
  await chooseOption(user, dialog, "Originator country of residence", "TR");

  await user.click(within(dialog).getByRole("button", { name: "Add Originator national identification" }));
  fireEvent.change(within(dialog).getByLabelText("Originator national identifier"), { target: { value: "NATIONAL-ID" } });
  await chooseOption(user, dialog, "Originator national identifier type", "MISC");
  await chooseOption(user, dialog, "Originator country of issue", "TR");
  fireEvent.change(within(dialog).getByLabelText("Originator registration authority"), { target: { value: "Authority" } });

  expect(within(dialog).getByLabelText("Originator account number 2")).toHaveValue("ORIGINATOR-ACCOUNT-2");
  expect(within(dialog).getByLabelText("Originator national identifier")).toHaveValue("NATIONAL-ID");
});

test("updates editable natural-person addresses and birth details", async () => {
  const user = userEvent.setup();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  fillTransfer(dialog);
  await next(user, dialog);
  fillOriginator(dialog);

  await user.click(within(dialog).getByRole("button", { name: "Add originator address" }));
  await user.click(within(dialog).getByRole("button", { name: "Add originator address" }));
  await chooseOption(user, dialog, "Originator address type 1", "HOME");
  await chooseOption(user, dialog, "Originator country 1", "TR");
  fireEvent.change(within(dialog).getByLabelText("Originator street name 1"), { target: { value: "Main Street" } });
  fireEvent.change(within(dialog).getByLabelText("Originator town name 1"), { target: { value: "Istanbul" } });
  await user.click(within(dialog).getAllByRole("button", { name: "Add address line" })[0]);
  fireEvent.change(within(dialog).getByLabelText("Originator address line 1 1"), { target: { value: "Line 1" } });

  await user.click(within(dialog).getByRole("button", { name: "Add Originator birth details" }));
  fireEvent.change(within(dialog).getByLabelText("Originator date of birth"), { target: { value: "2000-02-21" } });
  fireEvent.change(within(dialog).getByLabelText("Originator place of birth"), { target: { value: "Istanbul" } });

  expect(within(dialog).getByLabelText("Originator town name 1")).toHaveValue("Istanbul");
  expect(within(dialog).getByLabelText("Originator date of birth")).toHaveValue("2000-02-21");
});

test("updates legal-person names, registration, and national identification", async () => {
  const user = userEvent.setup();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  fillTransfer(dialog);
  await next(user, dialog);
  fillOriginator(dialog);
  await next(user, dialog);
  fillBeneficiary(dialog);

  await user.click(within(dialog).getByRole("button", { name: "Add name" }));
  fireEvent.change(within(dialog).getByLabelText("Beneficiary legal name 2"), { target: { value: "Example Short" } });
  await chooseOption(user, dialog, "Name type 2", "SHRT");
  await user.click(within(dialog).getByRole("button", { name: "Remove name 2" }));
  await chooseOption(user, dialog, "Beneficiary country of registration", "TR");

  await user.click(within(dialog).getByRole("button", { name: "Add Beneficiary national identification" }));
  fireEvent.change(within(dialog).getByLabelText("Beneficiary national identifier"), { target: { value: "LEGAL-ID" } });
  await chooseOption(user, dialog, "Beneficiary national identifier type", "LEIX");
  fireEvent.change(within(dialog).getByLabelText("Beneficiary registration authority"), { target: { value: "Legal Authority" } });

  expect(within(dialog).getByLabelText("Beneficiary country of registration")).toHaveTextContent("TR");
  expect(within(dialog).queryByLabelText("Beneficiary country of issue")).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText("Beneficiary registration authority")).toHaveValue("Legal Authority");
});

test("updates optional VASPs and an intermediary transfer-path person", async () => {
  const user = userEvent.setup();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  fillTransfer(dialog);
  await next(user, dialog);
  fillOriginator(dialog);
  await next(user, dialog);
  fillBeneficiary(dialog);
  await next(user, dialog);

  await user.click(within(dialog).getByRole("button", { name: "Add originating VASP" }));
  fireEvent.change(within(dialog).getByLabelText("Originating VASP legal name 1"), { target: { value: "Originating VASP Ltd" } });
  await user.click(within(dialog).getByRole("button", { name: "Add intermediary VASP" }));
  fireEvent.change(within(dialog).getByLabelText("Intermediary VASP 1 legal name 1"), { target: { value: "Intermediary VASP Ltd" } });
  fireEvent.change(within(dialog).getByLabelText("Intermediary VASP sequence 1"), { target: { value: "1" } });

  expect(within(dialog).getByLabelText("Originating VASP legal name 1")).toHaveValue("Originating VASP Ltd");
  expect(within(dialog).getByLabelText("Intermediary VASP 1 legal name 1")).toHaveValue("Intermediary VASP Ltd");
  expect(within(dialog).getByLabelText("Intermediary VASP sequence 1")).toHaveValue(0);
});

test("advances a non-final form submission and clears corrected step errors", () => {
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });
  const form = within(dialog).getByRole("form", { name: "New Transfer" });

  fireEvent.submit(form);
  expect(within(dialog).getByLabelText("Travel Address")).toHaveAttribute("aria-invalid", "true");

  fillTransfer(dialog);
  fireEvent.submit(form);

  expect(within(dialog).getByRole("button", { name: "Originator" })).toHaveAttribute("aria-current", "step");
  expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  expect(createTrpTransfer).not.toHaveBeenCalled();
});

test("returns to the first invalid step when final validation fails", async () => {
  const user = userEvent.setup();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  act(() => mockTransferStepperProps.onStepChange(4));
  await user.click(within(dialog).getByRole("button", { name: "Create transfer" }));

  expect(within(dialog).getByRole("button", { name: "Transfer" })).toHaveAttribute("aria-current", "step");
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/fields? need(?:s)? attention\./));
  expect(createTrpTransfer).not.toHaveBeenCalled();

  act(() => mockTransferStepperProps.onStepChange(3));
  await next(user, dialog);
  expect(within(dialog).getByRole("button", { name: "Metadata" })).toHaveAttribute("aria-current", "step");
});

test("edits and removes dynamic sections across all steps", async () => {
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={onOpenChange} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  fillTransfer(dialog);
  await next(user, dialog);
  fillOriginator(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "Add account number" }));
  fireEvent.change(within(dialog).getByLabelText("Originator account number 1"), { target: { value: "ACC-1" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove Originator account number 1" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Add originator person" }));
  expect(within(dialog).getByText("Originator person 2")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove originator person 2" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Add Originator national identification" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove Originator national identification" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Add Originator birth details" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove Originator birth details" }));
  await next(user, dialog);

  fillBeneficiary(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "Add beneficiary address" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove beneficiary address 1" }));
  await chooseOption(user, dialog, "Beneficiary person type", "Natural person");
  await chooseOption(user, dialog, "Beneficiary person type", "Legal person");
  await next(user, dialog);

  fireEvent.click(within(dialog).getByRole("button", { name: "Add originating VASP" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove Originating VASP" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Add beneficiary VASP" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove Beneficiary VASP" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Add intermediary VASP" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove intermediary VASP 1" }));
  await next(user, dialog);

  fireEvent.click(within(dialog).getByRole("button", { name: "Add transliteration method" }));
  await chooseOption(user, dialog, "Transliteration method 1", "arab");
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove transliteration method 1" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("keeps the dialog open and shows the sanitized API error after a rejected submission", async () => {
  const user = userEvent.setup();
  const onComplete = jest.fn();
  const onOpenChange = jest.fn();
  createTrpTransfer.mockRejectedValueOnce(new Error("sensitive backend detail"));
  render(<TransferCreateDialog onComplete={onComplete} onOpenChange={onOpenChange} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  await advanceToMetadata(user, dialog);
  await user.click(within(dialog).getByRole("button", { name: "Create transfer" }));

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not create the transfer."));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
  expect(onComplete).not.toHaveBeenCalled();
  expect(within(dialog).getByRole("button", { name: "Create transfer" })).toBeEnabled();
});

test("does not reset fields when the dialog requests close during submission", async () => {
  const user = userEvent.setup();
  let resolveTransfer;
  createTrpTransfer.mockReturnValueOnce(new Promise((resolve) => { resolveTransfer = resolve; }));
  const onOpenChange = jest.fn();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={onOpenChange} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });

  await advanceToMetadata(user, dialog);
  await user.click(within(dialog).getByRole("button", { name: "Create transfer" }));

  expect(onOpenChange).not.toHaveBeenCalled();
  expect(within(dialog).queryByRole("button", { name: "Close dialog" })).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Transfer" })).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "Metadata" })).toHaveAttribute("aria-current", "step");
  await user.keyboard("{Escape}");
  expect(onOpenChange).not.toHaveBeenCalled();
  act(() => mockTransferStepperProps.onStepChange(0));
  expect(within(dialog).getByRole("button", { name: "Metadata" })).toHaveAttribute("aria-current", "step");
  resolveTransfer({ id: "transfer-1" });
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledTimes(1));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});


test.each(["resolve", "reject"])("ignores a late %s after unmount and blocks duplicate submit", async (outcome) => {
  let finish;
  createTrpTransfer.mockReturnValueOnce(new Promise((resolve, reject) => { finish = outcome === "resolve" ? resolve : reject; }));
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  const onComplete = jest.fn();
  const { unmount } = render(<TransferCreateDialog open onOpenChange={onOpenChange} onComplete={onComplete} />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });
  await advanceToMetadata(user, dialog);
  const form = screen.getByRole("form", { name: "New Transfer" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(createTrpTransfer).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => { finish(new Error("late response")); });
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(onComplete).not.toHaveBeenCalled();
});

test("marks and focuses an input when only the identity-evidence group is invalid", async () => {
  const user = userEvent.setup();
  render(<TransferCreateDialog onComplete={jest.fn()} onOpenChange={jest.fn()} open />);
  const dialog = screen.getByRole("dialog", { name: "New Transfer" });
  fillTransfer(dialog);
  await next(user, dialog);
  fireEvent.change(screen.getByLabelText("Originator primary identifier 1"), { target: { value: "Smith" } });
  await next(user, dialog);
  expect(screen.getByLabelText("Originator customer number")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Originator customer number")).toHaveFocus();
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^1 field needs attention\. Originator customer number:/));
});
