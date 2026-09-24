import { render, screen } from "@testing-library/react";
import { Textarea } from "@/components/ui/textarea";
test("forwards accessible textarea attributes", () => { render(<Textarea aria-label="Payload" rows={4} />); expect(screen.getByRole("textbox", { name: "Payload" })).toHaveAttribute("rows", "4"); });
