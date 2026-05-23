import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/lib/theme/context";

function Probe() {
  const { preference, resolved } = useTheme();
  return <span data-testid="probe">{`${preference}/${resolved}`}</span>;
}

describe("ThemeProvider", () => {
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
});
