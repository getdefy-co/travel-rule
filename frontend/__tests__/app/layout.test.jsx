import { render, screen } from "@testing-library/react";

import RootLayout, { metadata } from "@/app/layout";

jest.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist-sans" }),
  Geist_Mono: () => ({ variable: "font-geist-mono" }),
}));
jest.mock("next-themes", () => ({ ThemeProvider: ({ children }) => <div data-testid="theme-provider">{children}</div> }));
jest.mock("@/i18n/i18n-provider", () => ({ I18nProvider: ({ children }) => <div data-testid="i18n-provider">{children}</div> }));
jest.mock("@/contexts/AuthContext", () => ({ AuthProvider: ({ children }) => <div data-testid="auth-provider">{children}</div> }));
jest.mock("@/components/ui/sonner", () => ({ Toaster: () => <div>toaster</div> }));

test("declares Defy Travel Rule metadata", () => {
  expect(metadata).toEqual({
    title: "Defy Travel Rule",
    description: "Defy Travel Rule user interface.",
  });
});

test("nests theme, i18n, and authentication providers", () => {
  const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  render(<RootLayout><p>content</p></RootLayout>);
  expect(screen.getByTestId("theme-provider")).toContainElement(screen.getByTestId("i18n-provider"));
  expect(screen.getByTestId("i18n-provider")).toContainElement(screen.getByTestId("auth-provider"));
  expect(screen.getByText("content")).toBeInTheDocument();
  expect(screen.getByText("toaster")).toBeInTheDocument();
  consoleError.mockRestore();
});
