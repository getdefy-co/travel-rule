import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogOverlay, AlertDialogPortal, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
test("renders an accessible open confirmation dialog", () => { render(<AlertDialog open><AlertDialogContent><AlertDialogTitle>Confirm</AlertDialogTitle><AlertDialogDescription>Proceed?</AlertDialogDescription></AlertDialogContent></AlertDialog>); expect(screen.getByRole("alertdialog", { name: "Confirm" })).toHaveAccessibleDescription("Proceed?"); });

test("supports trigger, media, action, and cancellation composition", async () => {
  const user = userEvent.setup();
  render(<AlertDialog><AlertDialogTrigger>Open</AlertDialogTrigger><AlertDialogContent size="sm"><AlertDialogHeader><AlertDialogMedia>!</AlertDialogMedia><AlertDialogTitle>Delete?</AlertDialogTitle><AlertDialogDescription>Permanent.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction>Continue</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>);
  await user.click(screen.getByRole("button", { name: "Open" }));
  expect(screen.getByRole("alertdialog", { name: "Delete?" })).toHaveTextContent("!");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

test("keeps overlay and portal exports composable", () => { render(<AlertDialog open><AlertDialogPortal><AlertDialogOverlay data-testid="overlay" /></AlertDialogPortal></AlertDialog>); expect(screen.getByTestId("overlay")).toHaveAttribute("data-slot", "alert-dialog-overlay"); });
