import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toggle } from "@/components/ui/toggle";
test("exposes pressed state", async () => { const user = userEvent.setup(); render(<Toggle>Filter</Toggle>); const button = screen.getByRole("button", { name: "Filter" }); await user.click(button); expect(button).toHaveAttribute("data-state", "on"); });
