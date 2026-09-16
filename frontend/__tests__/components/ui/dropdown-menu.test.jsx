import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

test("renders selectable, destructive and nested dropdown items", async () => {
  const user = userEvent.setup();
  render(<DropdownMenu><DropdownMenuTrigger>Open menu</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuLabel inset>Actions</DropdownMenuLabel><DropdownMenuGroup><DropdownMenuItem variant="destructive" inset>Delete</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuSub defaultOpen><DropdownMenuSubTrigger inset>More</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuItem>Archive</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>);
  await user.click(screen.getByRole("button", { name: "Open menu" }));
  expect(screen.getByRole("menuitem", { name: /Delete/ })).toHaveAttribute("data-variant", "destructive");
  await user.hover(screen.getByRole("menuitem", { name: /More/ }));
  expect(await screen.findByRole("menuitem", { name: "Archive" })).toBeInTheDocument();
});
