import { render, screen } from "@testing-library/react";
import Page from "@/app/travel-rule/messages/page";
jest.mock("@/components/app-shell", () => ({ AppShell: ({ children }) => <main>{children}</main> }));
jest.mock("@/components/resource-dashboard", () => ({ ResourceDashboard: ({ resource }) => <section>{resource}</section> }));
test("renders messages in the shared authenticated shell", () => { render(<Page />); expect(screen.getByRole("main")).toHaveTextContent("messages"); });
