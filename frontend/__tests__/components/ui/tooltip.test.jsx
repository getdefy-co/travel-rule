import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

test("shows tooltip content on keyboard focus with both provider forms", async () => {
  const user = userEvent.setup();
  render(<TooltipProvider delayDuration={5}><Tooltip><TooltipTrigger>Info</TooltipTrigger><TooltipContent sideOffset={4}>Helpful text</TooltipContent></Tooltip></TooltipProvider>);
  await user.tab();
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Helpful text");
});
