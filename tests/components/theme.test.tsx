import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/lib/theme/context";

function Probe() {
  const { preference, resolved } = useTheme();
  return <span data-testid="probe">{`${preference}/${resolved}`}</span>;
}

describe("ThemeProvider", () => {
  // Public pages always render light regardless of preference. These tests
  // simulate a portal path so the dark-class toggle is exercised.
  const originalPathname = window.location.pathname;

  beforeEach(() => {
    // jsdom defaults pathname to "/" which is treated as public — override it.
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, pathname: "/admin" },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, pathname: originalPathname },
    });
    document.documentElement.classList.remove("dark");
  });

  it("defaults to system / light", () => {
    const { getByTestId } = render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(getByTestId("probe").textContent).toMatch(/^system\//);
  });

  it("applies 'dark' class to documentElement when resolved dark", () => {
    render(<ThemeProvider initial="dark"><Probe /></ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes 'dark' class when resolved light", () => {
    document.documentElement.classList.add("dark");
    render(<ThemeProvider initial="light"><Probe /></ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("forces light on public paths even when preference is dark", () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, pathname: "/" },
    });
    document.documentElement.classList.add("dark");
    render(<ThemeProvider initial="dark"><Probe /></ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
