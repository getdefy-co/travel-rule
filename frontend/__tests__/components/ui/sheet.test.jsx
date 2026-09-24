import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

test.each(["right", "left", "top", "bottom"])("renders and closes %s sheet content", async (side) => {
  const user = userEvent.setup();
  render(<Sheet defaultOpen><SheetContent side={side}><SheetHeader><SheetTitle>Details</SheetTitle><SheetDescription>Task details</SheetDescription></SheetHeader></SheetContent></Sheet>);
  expect(screen.getByRole("dialog", { name: "Details" })).toHaveAccessibleDescription("Task details");
  await user.click(screen.getByRole("button", { name: "Close sheet" }));
  expect(screen.queryByRole("dialog", { name: "Details" })).not.toBeInTheDocument();
});

test("defaults sheet content to the right side", () => {
  render(<Sheet defaultOpen><SheetContent><SheetTitle>Default details</SheetTitle><SheetDescription>Default side</SheetDescription></SheetContent></Sheet>);
  expect(screen.getByRole("dialog", { name: "Default details" })).toHaveClass("data-[state=open]:slide-in-from-right");
});
