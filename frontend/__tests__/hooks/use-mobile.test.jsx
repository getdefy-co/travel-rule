import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";

import { useIsMobile } from "@/hooks/use-mobile";

test("subscribes to the mobile media query and reacts to viewport changes", () => {
  let matches = false;
  const listeners = new Set();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    addEventListener: jest.fn((_event, callback) => listeners.add(callback)),
    removeEventListener: jest.fn((_event, callback) => listeners.delete(callback)),
  };
  window.matchMedia = jest.fn(() => mediaQuery);

  const { result, unmount } = renderHook(() => useIsMobile());
  expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
  expect(result.current).toBe(false);
  act(() => {
    matches = true;
    listeners.forEach((listener) => listener(new Event("change")));
  });
  expect(result.current).toBe(true);
  unmount();
  expect(mediaQuery.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
});

test("provides a non-mobile server snapshot", () => {
  const MobileProbe = () => String(useIsMobile());
  expect(renderToString(<MobileProbe />)).toContain("false");
});
