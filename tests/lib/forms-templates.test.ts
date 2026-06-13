import { describe, it, expect } from "vitest";
import { ALL_SEED_TEMPLATES } from "@/lib/forms/seed-templates";

describe("seed templates", () => {
  it("exports 15 templates", () => {
    expect(ALL_SEED_TEMPLATES).toHaveLength(15);
  });

  it("each template has a unique (kind, version) pair", () => {
    // Kinds may repeat across versions (e.g. AIRBNB_TURNOVER v2/v3/v4); the seed
    // runner upserts by (kind, version), so that pair must be unique.
    const pairs = new Set(ALL_SEED_TEMPLATES.map((t) => `${t.kind}@${t.version}`));
    expect(pairs.size).toBe(ALL_SEED_TEMPLATES.length);
  });

  it("each template has at least one section with at least one field", () => {
    for (const t of ALL_SEED_TEMPLATES) {
      expect(t.schema.sections.length).toBeGreaterThan(0);
      for (const section of t.schema.sections) {
        expect(section.fields.length).toBeGreaterThan(0);
      }
    }
  });

  it("all field ids are unique within each template", () => {
    for (const t of ALL_SEED_TEMPLATES) {
      const ids = new Set<string>();
      for (const section of t.schema.sections) {
        for (const field of section.fields) {
          expect(
            ids.has(field.id),
            `Duplicate field id ${field.id} in ${t.kind}`,
          ).toBe(false);
          ids.add(field.id);
        }
      }
    }
  });

  it("end-of-lease has 60+ fields (industry standard)", () => {
    const eol = ALL_SEED_TEMPLATES.find((t) => t.kind === "END_OF_LEASE")!;
    const totalFields = eol.schema.sections.reduce(
      (sum, s) => sum + s.fields.length,
      0,
    );
    expect(totalFields).toBeGreaterThanOrEqual(60);
  });
});
