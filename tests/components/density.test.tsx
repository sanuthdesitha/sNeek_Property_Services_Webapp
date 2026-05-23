import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DensityProvider, useDensity } from "@/lib/density/context";

function Probe() {
  const density = useDensity();
  return <span data-testid="probe">{density}</span>;
}

describe("DensityProvider", () => {
  it("returns 'default' when no value set", () => {
    render(
      <DensityProvider>
        <Probe />
      </DensityProvider>
    );
    expect(screen.getByTestId("probe").textContent).toBe("default");
  });

  it("returns the explicit value passed", () => {
    render(
      <DensityProvider value="compact">
        <Probe />
      </DensityProvider>
    );
    expect(screen.getByTestId("probe").textContent).toBe("compact");
  });

  it("renders data-density on the root element", () => {
    const { container } = render(
      <DensityProvider value="comfortable">
        <Probe />
      </DensityProvider>
    );
    expect(container.firstChild).toHaveAttribute("data-density", "comfortable");
  });
});
