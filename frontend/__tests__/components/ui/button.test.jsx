import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button, buttonVariants } from "@/components/ui/button";

test("supports button variants, sizes, clicks and asChild composition", async () => {
  const user = userEvent.setup();
  const onClick = jest.fn();
  const { rerender } = render(<Button variant="outline" size="lg" onClick={onClick}>Continue</Button>);
  const button = screen.getByRole("button", { name: "Continue" });
  expect(button).toHaveClass("border", "h-10");
  expect(button).toHaveClass("focus-visible:ring-2", "focus-visible:ring-ring", "focus-visible:ring-offset-2", "focus-visible:ring-offset-background");
  for (const suppressedClass of ["outline-none", "focus:outline-none", "focus:ring-0", "focus-visible:outline-none", "focus-visible:ring-0"]) {
    expect(button).not.toHaveClass(suppressedClass);
  }
  await user.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(buttonVariants({ variant: "destructive", size: "icon" })).toContain("bg-destructive");
  expect(buttonVariants({ variant: "secondary", size: "sm" })).toContain("bg-secondary");
  expect(buttonVariants({ variant: "ghost" })).toContain("hover:bg-accent");
  expect(buttonVariants({ variant: "link" })).toContain("underline-offset-4");
  rerender(<Button asChild><a href="/next">Next</a></Button>);
  expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("data-slot", "button");
});
