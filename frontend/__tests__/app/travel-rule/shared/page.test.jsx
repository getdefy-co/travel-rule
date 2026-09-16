import { render, screen } from "@testing-library/react";

import Page from "@/app/travel-rule/shared/page";

jest.mock("@/components/transfer-email-access", () => ({ TransferEmailAccess: () => <main>Public transfer access</main> }));

test("renders public transfer access without the authenticated application shell", () => {
  render(<Page />);
  expect(screen.getByRole("main")).toHaveTextContent("Public transfer access");
});
