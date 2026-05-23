import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

describe("Input", () => {
  it("renders with rounded (8px), not rounded-xl", () => {
    render(<Input data-testid="i" />);
    const cls = screen.getByTestId("i").className;
    expect(cls).toMatch(/\brounded\b/);
    expect(cls).not.toMatch(/\brounded-xl\b/);
  });

  it("uses bg-surface, not bg-white/80", () => {
    render(<Input data-testid="i" />);
    const cls = screen.getByTestId("i").className;
    expect(cls).toMatch(/bg-surface\b/);
    expect(cls).not.toMatch(/bg-white\/80/);
  });

  it("has visible focus ring with --ring color", () => {
    render(<Input data-testid="i" />);
    const cls = screen.getByTestId("i").className;
    expect(cls).toMatch(/focus-visible:ring-2/);
    expect(cls).toMatch(/focus-visible:ring-ring/);
  });
});

describe("Textarea", () => {
  it("uses same surface + radius as Input", () => {
    render(<Textarea data-testid="t" />);
    const cls = screen.getByTestId("t").className;
    expect(cls).toMatch(/\brounded\b/);
    expect(cls).toMatch(/bg-surface\b/);
  });
});
