import { describe, it, expect } from "vitest";
import { SEED_REPORT_THEMES } from "@/lib/reports/seed-themes";

describe("seed report themes", () => {
  it("exports 3 themes", () => expect(SEED_REPORT_THEMES).toHaveLength(3));

  it("exactly one is marked isDefault", () => {
    expect(SEED_REPORT_THEMES.filter((t) => t.isDefault)).toHaveLength(1);
  });

  it("magazine is the default", () => {
    expect(SEED_REPORT_THEMES.find((t) => t.kind === "MAGAZINE")?.isDefault).toBe(true);
  });

  it("each theme has 7 layout sections", () => {
    for (const t of SEED_REPORT_THEMES) {
      expect(t.layout.sections).toHaveLength(7);
    }
  });

  it("each section has a unique id within the theme", () => {
    for (const t of SEED_REPORT_THEMES) {
      const ids = new Set(t.layout.sections.map((s) => s.id));
      expect(ids.size).toBe(t.layout.sections.length);
    }
  });
});
