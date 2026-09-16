import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Input } from "@/components/ui/input";

test("forwards input type, classes and change events", async () => {
  const user = userEvent.setup();
  const onChange = jest.fn();
  render(<Input aria-label="Email" type="email" className="custom" onChange={onChange} />);
  const input = screen.getByRole("textbox", { name: "Email" });
  expect(input).toHaveAttribute("type", "email");
  expect(input).toHaveClass("custom");
  await user.type(input, "a@b.co");
  expect(onChange).toHaveBeenCalled();
});
