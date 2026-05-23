import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Toaster } from "@/components/ui/toaster";

describe("Toaster", () => {
  it("renders without crashing (smoke)", () => {
    const { baseElement } = render(<Toaster />);
    expect(baseElement).toBeTruthy();
  });
});
