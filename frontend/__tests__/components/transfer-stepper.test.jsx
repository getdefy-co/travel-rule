import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TransferStepper } from "@/components/transfer-stepper";

const steps = [
  { id: "transfer", label: "Transfer" },
  { id: "originator", label: "Originator" },
  { id: "beneficiary", label: "Beneficiary" },
  { id: "vasps", label: "VASPs & Path" },
  { id: "metadata", label: "Metadata" },
];

test("renders active, completed and pending steps with accessible navigation", () => {
  render(
    <TransferStepper
      activeStep={1}
      ariaLabel="Transfer creation progress"
      completedSteps={[0]}
      errorSteps={[]}
      onStepChange={jest.fn()}
      progressLabel="Step 2 of 5: Originator"
      steps={steps}
    />,
  );

  expect(screen.getByRole("navigation", { name: "Transfer creation progress" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Originator" })).toHaveAttribute("aria-current", "step");
  expect(screen.getByRole("button", { name: "Originator" })).toHaveAttribute("data-state", "active");
  expect(screen.getByRole("button", { name: "Originator" })).toHaveClass("bg-primary", "text-primary-foreground");
  expect(screen.getByRole("button", { name: "Beneficiary" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Metadata" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Transfer" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Transfer" })).toHaveAttribute("data-state", "completed");
  expect(screen.getByTestId("transfer-step-check")).toBeInTheDocument();
  expect(screen.getAllByTestId("transfer-step-connector")[0]).toHaveAttribute("data-state", "completed");
  expect(screen.getAllByTestId("transfer-step-connector")[0]).toHaveClass("bg-primary");
});

test("allows completed-step navigation while keeping future steps locked", async () => {
  const user = userEvent.setup();
  const onStepChange = jest.fn();

  render(
    <TransferStepper
      activeStep={2}
      ariaLabel="Transfer creation progress"
      completedSteps={[0, 1]}
      errorSteps={[]}
      onStepChange={onStepChange}
      progressLabel="Step 3 of 5: Beneficiary"
      steps={steps}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Originator" }));
  expect(onStepChange).toHaveBeenCalledWith(1);

  await user.click(screen.getByRole("button", { name: "Beneficiary" }));
  expect(onStepChange).toHaveBeenCalledWith(2);
  expect(screen.getByRole("button", { name: "VASPs & Path" })).toBeDisabled();
});

test("renders a destructive error state and localized compact mobile progress", () => {
  render(
    <TransferStepper
      activeStep={1}
      ariaLabel="Transfer creation progress"
      completedSteps={[0]}
      errorSteps={[1]}
      onStepChange={jest.fn()}
      progressLabel="Adım 2 / 5: Originator"
      steps={steps}
    />,
  );

  expect(screen.getByRole("button", { name: "Originator" })).toHaveAttribute("data-state", "error");
  expect(screen.getByRole("button", { name: "Originator" })).toHaveClass(
    "border-destructive",
    "bg-destructive",
    "text-white",
  );
  expect(screen.getByText("Adım 2 / 5: Originator")).toHaveClass("sm:hidden");

  const titles = screen.getAllByTestId("transfer-step-title");
  expect(titles).toHaveLength(5);
  for (const title of titles) {
    expect(title).toHaveClass("hidden", "sm:block");
  }
});

test("disables every step trigger while the parent operation is pending", () => {
  render(
    <TransferStepper
      activeStep={1}
      ariaLabel="Transfer creation progress"
      completedSteps={[0]}
      disabled
      errorSteps={[]}
      onStepChange={jest.fn()}
      progressLabel="Step 2 of 5: Originator"
      steps={steps}
    />,
  );

  for (const step of steps) expect(screen.getByRole("button", { name: step.label })).toBeDisabled();
});
