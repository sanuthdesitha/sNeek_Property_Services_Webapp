import { describe, it, expect } from "vitest";
import { SEED_REPORT_THEMES } from "@/lib/reports/seed-themes";

describe("seed report themes", () => {
  it("exports 4 themes", () => expect(SEED_REPORT_THEMES).toHaveLength(4));

  it("exactly one is marked isDefault", () => {
    expect(SEED_REPORT_THEMES.filter((t) => t.isDefault)).toHaveLength(1);
  });

  it("luxury is the default", () => {
    expect(SEED_REPORT_THEMES.find((t) => t.name === "Luxury")?.isDefault).toBe(true);
  });

  it("the old themes (compact/magazine/detailed) remain present and selectable", () => {
    for (const name of ["Compact", "Magazine", "Detailed"]) {
      expect(SEED_REPORT_THEMES.find((t) => t.name === name)).toBeDefined();
    }
  });

  it("each theme has 8 layout sections including qa-summary", () => {
    for (const t of SEED_REPORT_THEMES) {
      expect(t.layout.sections).toHaveLength(8);
      expect(t.layout.sections.some((s) => s.id === "qa-summary")).toBe(true);
    }
  });

  it("each section has a unique id within the theme", () => {
    for (const t of SEED_REPORT_THEMES) {
      const ids = new Set(t.layout.sections.map((s) => s.id));
      expect(ids.size).toBe(t.layout.sections.length);
    }
  });
});
