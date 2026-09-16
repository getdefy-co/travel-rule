import { render, screen } from "@testing-library/react";

import { Label } from "@/components/ui/label";

test("associates its text with a form control", () => {
  render(<><Label htmlFor="name" className="custom">Name</Label><input id="name" /></>);
  expect(screen.getByLabelText("Name")).toBeInTheDocument();
  expect(screen.getByText("Name")).toHaveClass("custom");
});
