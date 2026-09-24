import { render, screen } from "@testing-library/react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

test("composes all card regions with forwarded classes", () => {
  render(<Card data-testid="card" className="custom"><CardHeader><CardTitle>Title</CardTitle><CardDescription>Description</CardDescription></CardHeader><CardContent>Content</CardContent><CardFooter>Footer</CardFooter></Card>);
  expect(screen.getByText("Title")).toHaveAttribute("data-slot", "card-title");
  expect(screen.getByText("Description")).toHaveAttribute("data-slot", "card-description");
  expect(screen.getByText("Content")).toHaveAttribute("data-slot", "card-content");
  expect(screen.getByText("Footer")).toHaveAttribute("data-slot", "card-footer");
  expect(screen.getByTestId("card")).toHaveClass("custom");
});
