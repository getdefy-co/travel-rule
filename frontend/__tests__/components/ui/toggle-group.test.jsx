import { render, screen } from "@testing-library/react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
test("renders a single-select accessible toggle group", () => { render(<ToggleGroup aria-label="Range" type="single" value="7d"><ToggleGroupItem value="7d">7D</ToggleGroupItem></ToggleGroup>); expect(screen.getByRole("radiogroup", { name: "Range" })).toBeInTheDocument(); expect(screen.getByRole("radio", { name: "7D" })).toBeChecked(); });
