import { render, screen } from "@testing-library/react";

import { Skeleton } from "@/components/ui/skeleton";

test("renders a shimmer placeholder with caller dimensions", () => {
  render(<Skeleton className="h-4 w-24" data-testid="skeleton" />);

  expect(screen.getByTestId("skeleton")).toHaveClass("h-4", "w-24", "animate-pulse");
});
