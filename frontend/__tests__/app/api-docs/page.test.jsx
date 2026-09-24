import { render, screen } from "@testing-library/react";

import Page from "@/app/api-docs/page";

jest.mock("@/components/app-shell", () => ({ AppShell: ({ children, requiredRole }) => <main data-required-role={requiredRole}>{children}</main> }));
jest.mock("@/components/api-docs", () => ({ ApiDocs: () => <section aria-label="Travel Rule API documentation">api-docs</section> }));

test("renders API Docs in the shared authenticated shell without a role restriction", () => {
  render(<Page />);

  expect(screen.getByRole("main")).not.toHaveAttribute("data-required-role");
  expect(screen.getByRole("region", { name: "Travel Rule API documentation" })).toHaveTextContent("api-docs");
});
