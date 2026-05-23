import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom does not implement Element.scrollIntoView; stub it for libs like cmdk.
if (typeof window !== "undefined" && !(window.Element.prototype as any).scrollIntoView) {
  (window.Element.prototype as any).scrollIntoView = function () {};
}

// jsdom does not implement ResizeObserver; stub it for libs like cmdk.
if (typeof globalThis !== "undefined" && !(globalThis as any).ResizeObserver) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom does not implement matchMedia; stub it for components that read it.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  cleanup();
});
