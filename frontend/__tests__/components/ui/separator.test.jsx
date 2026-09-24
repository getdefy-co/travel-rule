import { render, screen } from "@testing-library/react";

import { Separator } from "@/components/ui/separator";

test("renders decorative horizontal and semantic vertical separators", () => {
  const { rerender } = render(<Separator data-testid="separator" className="custom" />);
  expect(screen.getByTestId("separator")).toHaveAttribute("data-orientation", "horizontal");
  rerender(<Separator orientation="vertical" decorative={false} />);
  expect(screen.getByRole("separator")).toHaveAttribute("data-orientation", "vertical");
});
