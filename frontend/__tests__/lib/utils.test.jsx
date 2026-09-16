import fs from "node:fs";
import path from "node:path";
import { toast } from "sonner";

import { cn, copyToClipboard, getActionBadgeColor, getNetworkBadgeColor } from "@/lib/utils";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const getThemeToken = (css, selector, token) => {
  const block = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  return block?.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1].trim();
};

describe("shared UI utilities", () => {
  test("uses the configured primary palette in light and dark themes", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const lightPrimary = getThemeToken(css, ":root", "--primary");
    const lightForeground = getThemeToken(css, ":root", "--primary-foreground");
    const darkPrimary = getThemeToken(css, "\\.dark", "--primary");
    const darkForeground = getThemeToken(css, "\\.dark", "--primary-foreground");

    expect(lightPrimary).toBe("#00aced");
    expect(lightForeground).toBe("#ffffff");
    expect(darkPrimary).toBe("oklch(0.922 0 0)");
    expect(darkForeground).toBe("oklch(0.205 0 0)");
  });

  test("merges conditional and conflicting Tailwind classes", () => {
    const isHidden = false;
    expect(cn("px-2", isHidden && "hidden", "px-4")).toBe("px-4");
  });

  test.each(["eth", "bsc", "polygon", "avalanche", "bitcoin", "trx", "solana", "xrp", "arbitrum", "optimism", "unknown", undefined])(
    "returns a complete badge class for network %s",
    (network) => {
      expect(getNetworkBadgeColor(network)).toMatch(/bg-.+ text-.+ border-/);
    },
  );

  test.each(["block", "suspicious", "no_block"])("returns a complete badge class for action %s", (action) => {
    expect(getActionBadgeColor(action)).toMatch(/bg-.+ text-.+ border-/);
  });

  test("copies text and confirms the observable action", async () => {
    await copyToClipboard("0xabc");

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("0xabc");
    expect(toast.success).toHaveBeenCalledWith("Copied to clipboard.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  test("reports clipboard failures without confirming success", async () => {
    navigator.clipboard.writeText.mockRejectedValueOnce(new Error("denied"));

    await copyToClipboard("0xdef");

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("0xdef");
    expect(toast.error).toHaveBeenCalledWith("Could not copy to clipboard.");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
