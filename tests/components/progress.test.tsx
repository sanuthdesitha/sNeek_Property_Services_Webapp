import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Progress } from "@/components/ui/progress";

describe("Progress", () => {
  it("has role=progressbar and a11y label when label prop passed", () => {
    const { container } = render(<Progress value={40} label="Upload progress" />);
    const bar = container.querySelector("[role=progressbar]");
    expect(bar).toBeTruthy();
    expect(bar).toHaveAttribute("aria-label", "Upload progress");
  });

  it("accepts aria-label directly", () => {
    const { container } = render(<Progress value={50} aria-label="50%" />);
    expect(container.querySelector("[role=progressbar]")).toHaveAttribute("aria-label", "50%");
  });
});
