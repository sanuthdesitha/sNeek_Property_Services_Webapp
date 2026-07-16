import { describe, expect, it } from "vitest";
import { isJunkMistakeLabel } from "@/lib/workforce/mistakes";

describe("isJunkMistakeLabel", () => {
  it("treats empty, test, short, and placeholder labels as junk", () => {
    for (const junk of ["", "   ", "Test", "test", "TEST 1", "xx", "n/a", "na", "-", ".", "asdf", "xxx"]) {
      expect(isJunkMistakeLabel(junk)).toBe(true);
    }
  });

  it("keeps real coaching labels", () => {
    for (const real of ["Coffee machine filter", "Bathroom glass", "Balcony reset"]) {
      expect(isJunkMistakeLabel(real)).toBe(false);
    }
  });
});
