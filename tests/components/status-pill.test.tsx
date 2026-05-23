import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "@/components/ui/status-pill";

describe("StatusPill", () => {
  it("renders all 8 variants per spec §3.2", () => {
    const variants = [
      "neutral", "info", "success", "warning", "danger", "primary", "accent", "purple",
    ] as const;
    for (const v of variants) {
      const { container, unmount } = render(<StatusPill variant={v}>{v}</StatusPill>);
      expect(container.querySelector("span")).toBeInTheDocument();
      unmount();
    }
  });

  it("renders dot indicator when withDot is true", () => {
    render(<StatusPill variant="success" withDot>Completed</StatusPill>);
    expect(screen.getByLabelText("indicator")).toBeInTheDocument();
  });

  it("uses rounded-full (pill shape)", () => {
    render(<StatusPill variant="info" data-testid="p">x</StatusPill>);
    expect(screen.getByTestId("p").className).toMatch(/rounded-full/);
  });
});
