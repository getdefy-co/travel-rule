import { fireEvent, render, screen } from "@testing-library/react";

import { Toaster } from "@/components/ui/sonner";

const mockSonner = jest.fn((props) => <div data-testid="sonner" data-theme={props.theme} className={props.className} />);
const mockUseTheme = jest.fn();
const mockDismiss = jest.fn();
const mockGetToasts = jest.fn(() => []);

jest.mock("sonner", () => ({ Toaster: (props) => mockSonner(props), toast: { dismiss: (...args) => mockDismiss(...args), getToasts: () => mockGetToasts() } }));
jest.mock("next-themes", () => ({ useTheme: () => mockUseTheme() }));

test("forwards the active theme and toaster customization", () => {
  mockUseTheme.mockReturnValue({ theme: "dark" });
  const { rerender } = render(<Toaster position="top-right" />);
  expect(screen.getByTestId("sonner")).toHaveAttribute("data-theme", "dark");
  expect(mockSonner).toHaveBeenCalledWith(expect.objectContaining({ position: "top-right", className: "toaster group pointer-events-auto", closeButton: true }));
  mockUseTheme.mockReturnValue({});
  rerender(<Toaster />);
  expect(screen.getByTestId("sonner")).toHaveAttribute("data-theme", "system");
});

test("dismisses only the latest toast by keyboard without moving modal focus", () => {
  render(<Toaster />);
  fireEvent.keyDown(document, { key: "Escape" });
  fireEvent.keyDown(document, { key: "T", altKey: true });
  fireEvent.keyDown(document, { key: "Escape", altKey: true });
  expect(mockDismiss).not.toHaveBeenCalled();
  mockGetToasts.mockReturnValue([{ id: "first" }, { id: "last" }]);
  fireEvent.keyDown(document, { key: "Escape", altKey: true });
  expect(mockDismiss).toHaveBeenCalledWith("last");
});

test("keeps toast interactions from dismissing an open modal", () => {
  const outsidePointer = jest.fn();
  document.addEventListener("pointerdown", outsidePointer);
  render(<Toaster />);
  fireEvent.pointerDown(screen.getByTestId("sonner"));
  expect(outsidePointer).not.toHaveBeenCalled();
  document.removeEventListener("pointerdown", outsidePointer);
});
