import { describe, it, expect } from "vitest";
import { isRotationalItemDue } from "@/lib/accountability/rotation";

describe("isRotationalItemDue", () => {
  it("is due when the item has never been completed (no state)", () => {
    expect(isRotationalItemDue(null, 4)).toBe(true);
    expect(isRotationalItemDue(undefined, 4)).toBe(true);
  });

  it("is not due when fewer than cadence cleans have passed", () => {
    // cadence 4, 2 cleans since done → 2 + 1 = 3 < 4
    expect(isRotationalItemDue({ cleansSinceDone: 2 }, 4)).toBe(false);
  });

  it("is due once counting this clean reaches the cadence", () => {
    // cadence 4, 3 cleans since done → 3 + 1 = 4 >= 4
    expect(isRotationalItemDue({ cleansSinceDone: 3 }, 4)).toBe(true);
    // and stays due beyond
    expect(isRotationalItemDue({ cleansSinceDone: 5 }, 4)).toBe(true);
  });

  it("is never due without a valid cadence", () => {
    expect(isRotationalItemDue({ cleansSinceDone: 10 }, null)).toBe(false);
    expect(isRotationalItemDue({ cleansSinceDone: 10 }, undefined)).toBe(false);
    expect(isRotationalItemDue({ cleansSinceDone: 10 }, 0)).toBe(false);
    expect(isRotationalItemDue(null, 0)).toBe(false);
  });

  it("treats cadence 1 as due every clean", () => {
    expect(isRotationalItemDue({ cleansSinceDone: 0 }, 1)).toBe(true);
    expect(isRotationalItemDue(null, 1)).toBe(true);
  });
});
