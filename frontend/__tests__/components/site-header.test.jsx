import { render, screen } from "@testing-library/react";

import { SiteHeader } from "@/components/site-header";

jest.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: (props) => <button {...props}>Toggle navigation</button> }));
jest.mock("@/components/ui/separator", () => ({ Separator: (props) => <span role="separator" {...props} /> }));

test("renders the navigation trigger and vertical separator", () => {
  render(<SiteHeader />);
  expect(screen.getByRole("banner")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Toggle navigation" })).toBeInTheDocument();
  expect(screen.getByRole("separator")).toHaveAttribute("orientation", "vertical");
});
