import { render, screen } from "@testing-library/react";

import Page from "@/app/api-docs/reference/page";

jest.mock("@/components/app-shell", () => ({ AppShell: ({ children, requiredRole }) => <main data-required-role={requiredRole}>{children}</main> }));
jest.mock("@/components/api-reference", () => ({ ApiReference: () => <section aria-label="Travel Rule API reference">api-reference</section> }));

test("renders API Reference in the shared authenticated shell without a role restriction", () => {
  render(<Page />);

  expect(screen.getByRole("main")).not.toHaveAttribute("data-required-role");
  expect(screen.getByRole("region", { name: "Travel Rule API reference" })).toHaveTextContent("api-reference");
});
