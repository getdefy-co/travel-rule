import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiDocs } from "@/components/api-docs";
import { toast } from "sonner";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const setItemSpy = jest.spyOn(Storage.prototype, "setItem");

beforeEach(() => {
  setItemSpy.mockClear();
});

test("presents the private integration boundary and defaults to the protocol-neutral quickstart", () => {
  render(<ApiDocs />);

  expect(screen.getByRole("region", { name: "Travel Rule API documentation" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Integrate with Defy", level: 1 })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("backend:3002");
  expect(screen.getByRole("alert")).toHaveTextContent("PROTOCOL=TRP");
  expect(screen.getByRole("alert")).toHaveTextContent("X-API-Key");
  expect(screen.getByRole("tab", { name: "Protocol-neutral v1" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("region", { name: "Protocol-neutral v1 quickstart" })).toHaveTextContent("Idempotency-Key");
  expect(screen.getByRole("link", { name: "View API Reference" })).toHaveAttribute("href", "/api-docs/reference");
});

test("switches to the direct TRP quickstart without embedding the API reference", async () => {
  const user = userEvent.setup();
  render(<ApiDocs />);

  await user.click(screen.getByRole("tab", { name: "Direct TRP" }));

  expect(screen.getByRole("tab", { name: "Direct TRP" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("region", { name: "Direct TRP quickstart" })).toHaveTextContent("Travel Address");
  expect(screen.queryByRole("region", { name: "Travel Rule API reference" })).not.toBeInTheDocument();
});

test("copies a synthetic example without persisting it in browser storage", async () => {
  const user = userEvent.setup();
  const clipboardSpy = jest.spyOn(navigator.clipboard, "writeText");
  render(<ApiDocs />);

  await user.click(screen.getByRole("button", { name: "Copy environment setup" }));

  expect(clipboardSpy).toHaveBeenCalledWith(expect.stringContaining("DEFY_INTERNAL_BASE_URL=http://backend:3002"));
  expect(toast.success).toHaveBeenCalledWith("Copied to clipboard.");
  expect(setItemSpy).not.toHaveBeenCalled();
});

test("reports clipboard failures without leaking the example", async () => {
  const user = userEvent.setup();
  jest.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
  render(<ApiDocs />);

  await user.click(screen.getByRole("button", { name: "Copy environment setup" }));

  expect(toast.error).toHaveBeenCalledWith("Could not copy to clipboard.");
  expect(setItemSpy).not.toHaveBeenCalled();
});
