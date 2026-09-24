import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Select, SelectContent, SelectItem, SelectScrollDownButton, SelectScrollUpButton, SelectTrigger, SelectValue } from "@/components/ui/select";

test("opens a grouped select and commits an option", async () => {
  const user = userEvent.setup();
  const onValueChange = jest.fn();
  render(<Select onValueChange={onValueChange}><SelectTrigger aria-label="Network" size="sm"><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent position="item-aligned"><SelectItem value="eth">Ethereum</SelectItem><SelectItem value="bsc">BSC</SelectItem></SelectContent></Select>);
  const trigger = screen.getByRole("combobox", { name: "Network" });
  expect(trigger).toHaveClass("focus-visible:ring-2", "focus-visible:ring-ring", "focus-visible:ring-offset-2", "focus-visible:ring-offset-background");
  for (const suppressedClass of ["outline-none", "focus:outline-none", "focus:ring-0", "focus-visible:outline-none", "focus-visible:ring-0"]) {
    expect(trigger).not.toHaveClass(suppressedClass);
  }
  await user.click(trigger);
  expect(screen.getByRole("option", { name: "Ethereum" })).toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: "Ethereum" }));
  expect(onValueChange).toHaveBeenCalledWith("eth");
});

test("uses default trigger size and popper positioning", async () => {
  const user = userEvent.setup();
  render(<Select><SelectTrigger aria-label="Status"><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent><SelectItem value="open">Open</SelectItem></SelectContent></Select>);
  expect(screen.getByRole("combobox", { name: "Status" })).toHaveAttribute("data-size", "default");
  await user.click(screen.getByRole("combobox", { name: "Status" }));
  expect(screen.getByRole("option", { name: "Open" })).toBeInTheDocument();
});

test("keeps the public select scroll button exports renderable", async () => {
  render(<Select open><SelectTrigger aria-label="Network"><SelectValue placeholder="Choose" /></SelectTrigger><SelectContent><SelectScrollUpButton data-testid="public-scroll-up" /><SelectItem value="eth">Ethereum</SelectItem><SelectScrollDownButton data-testid="public-scroll-down" /></SelectContent></Select>);

  const viewport = screen.getByRole("presentation");
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 200 },
  });
  fireEvent.scroll(viewport);

  await waitFor(() => expect(screen.getByTestId("public-scroll-down")).toHaveAttribute("data-slot", "select-scroll-down-button"));

  viewport.scrollTop = 50;
  fireEvent.scroll(viewport);

  await waitFor(() => expect(screen.getByTestId("public-scroll-up")).toHaveAttribute("data-slot", "select-scroll-up-button"));
});
