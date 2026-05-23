import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders all 6 variants", () => {
    const variants = ["default", "secondary", "ghost", "outline", "destructive", "link"] as const;
    for (const v of variants) {
      render(<Button variant={v}>{v}</Button>);
      expect(screen.getByRole("button", { name: v })).toBeInTheDocument();
    }
  });

  it("uses rounded (8px) by default, not rounded-xl", () => {
    render(<Button>x</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toMatch(/\brounded\b/);
    expect(cls).not.toMatch(/\brounded-xl\b/);
  });

  it("has no hover-translate (motion toned down per spec §8)", () => {
    render(<Button>x</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).not.toMatch(/hover:-translate/);
  });

  it("size icon is 40×40 by default density", () => {
    render(<Button size="icon" aria-label="x">x</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toMatch(/h-10/);
    expect(cls).toMatch(/w-10/);
  });
});
