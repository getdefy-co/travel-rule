import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";

test("opens, describes and closes a dialog", async () => {
  const user = userEvent.setup();
  const onOpenChange = jest.fn();
  render(<Dialog open onOpenChange={onOpenChange}><DialogContent className="custom"><DialogHeader><DialogTitle>Settings</DialogTitle><DialogDescription>Update settings</DialogDescription></DialogHeader><p>Body</p><DialogFooter>Actions</DialogFooter></DialogContent></Dialog>);
  expect(screen.getByRole("dialog", { name: "Settings" })).toHaveAccessibleDescription("Update settings");
  expect(screen.getByText("Body")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("keeps the public dialog portal and overlay exports renderable", () => {
  render(<Dialog open><DialogPortal><DialogOverlay data-testid="public-dialog-overlay" /></DialogPortal><DialogContent><DialogTitle>Settings</DialogTitle></DialogContent></Dialog>);

  expect(screen.getByTestId("public-dialog-overlay")).toHaveAttribute("data-slot", "dialog-overlay");
});
