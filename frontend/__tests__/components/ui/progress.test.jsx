import { render, screen } from "@testing-library/react";
import { Progress } from "@/components/ui/progress";
test("exposes the current progress value to assistive technology", () => { render(<Progress aria-label="Delivery" value={45} />); expect(screen.getByRole("progressbar", { name: "Delivery" })).toHaveValue(45); });
