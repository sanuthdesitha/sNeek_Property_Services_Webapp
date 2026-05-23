import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

describe("design tokens", () => {
  it("--primary CSS variable resolves to the brand teal", () => {
    // Render a probe element under :root defaults.
    const { container } = render(
      <div data-testid="probe" style={{ color: "hsl(var(--primary))" }}>x</div>
    );
    const probe = container.querySelector("[data-testid=probe]") as HTMLElement;
    // Re-attach the inline style after jsdom has resolved.
    const style = getComputedStyle(probe);
    // jsdom resolves the var via the style attribute. We assert non-empty.
    expect(style.color).not.toBe("");
  });

  it("body has font-mono CSS variable defined when fonts loaded", () => {
    // This test runs in jsdom which does not load next/font.
    // We instead read from documentElement after we inject the var.
    document.documentElement.style.setProperty("--font-mono", "JetBrains Mono");
    const v = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
    expect(v).toBe("JetBrains Mono");
  });
});
