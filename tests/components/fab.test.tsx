import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FAB } from "@/components/ui/fab";

describe("FAB", () => {
  it("renders a button with aria-label", () => {
    render(<FAB aria-label="Create job" icon={<span>+</span>} onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Create job" })).toBeInTheDocument();
  });

  it("has shadow-fab and rounded-full", () => {
    render(<FAB aria-label="x" icon={<span>+</span>} onClick={() => {}} data-testid="fab" />);
    const cls = screen.getByTestId("fab").className;
    expect(cls).toMatch(/shadow-fab/);
    expect(cls).toMatch(/rounded-full/);
  });

  it("is fixed bottom-right by default", () => {
    render(<FAB aria-label="x" icon={<span>+</span>} onClick={() => {}} data-testid="fab" />);
    const cls = screen.getByTestId("fab").className;
    expect(cls).toMatch(/fixed/);
    expect(cls).toMatch(/bottom-/);
    expect(cls).toMatch(/right-/);
  });
});
