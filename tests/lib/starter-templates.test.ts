import { describe, it, expect } from "vitest";
import { JobType, FormKind } from "@prisma/client";
import {
  STARTER_TEMPLATES,
  getStarterTemplate,
  starterTemplateStats,
  type StarterTemplate,
} from "@/lib/forms/starter-templates";
import { normalizeFormSchema } from "@/lib/forms/normalize-schema";
import { FIELD_TYPES } from "@/lib/forms/field-types";
import {
  duplicateTemplateName,
  nextTemplateVersion,
  stripCopySuffix,
} from "@/lib/forms/duplicate-template";

function allFields(template: StarterTemplate) {
  return template.schema.sections.flatMap((s) => [
    ...s.fields,
    ...s.fields.flatMap((f) => f.children ?? []),
  ]);
}

describe("starter templates", () => {
  it("exposes a usable gallery", () => {
    expect(STARTER_TEMPLATES.length).toBeGreaterThanOrEqual(8);
  });

  it("has unique ids and non-empty copy for the picker", () => {
    const ids = new Set(STARTER_TEMPLATES.map((t) => t.id));
    expect(ids.size).toBe(STARTER_TEMPLATES.length);
    for (const t of STARTER_TEMPLATES) {
      expect(t.name.trim().length, t.id).toBeGreaterThan(0);
      expect(t.description.trim().length, t.id).toBeGreaterThan(20);
      expect(t.tags.length, t.id).toBeGreaterThan(0);
    }
  });

  it("declares a real JobType and FormKind", () => {
    for (const t of STARTER_TEMPLATES) {
      expect(Object.values(JobType), t.id).toContain(t.serviceType);
      expect(Object.values(FormKind), t.id).toContain(t.kind);
    }
  });

  it("has sections that all carry at least one field", () => {
    for (const t of STARTER_TEMPLATES) {
      expect(t.schema.sections.length, t.id).toBeGreaterThanOrEqual(3);
      for (const section of t.schema.sections) {
        expect(section.id.trim().length, `${t.id}/${section.title}`).toBeGreaterThan(0);
        expect(section.fields.length, `${t.id}/${section.id}`).toBeGreaterThan(0);
      }
    }
  });

  it("uses unique field ids within each template", () => {
    for (const t of STARTER_TEMPLATES) {
      const seen = new Set<string>();
      for (const field of allFields(t)) {
        expect(seen.has(field.id), `duplicate field id ${field.id} in ${t.id}`).toBe(false);
        seen.add(field.id);
      }
    }
  });

  it("uses only field types the registry knows about", () => {
    for (const t of STARTER_TEMPLATES) {
      for (const field of allFields(t)) {
        expect(FIELD_TYPES[field.type], `${t.id}/${field.id} → ${field.type}`).toBeDefined();
      }
    }
  });

  it("gives every photo-proof field a minPhotos floor", () => {
    for (const t of STARTER_TEMPLATES) {
      const photoFields = allFields(t).filter((f) => f.type === "photo");
      expect(photoFields.length, `${t.id} has no photo proof`).toBeGreaterThan(0);
      for (const field of photoFields) {
        expect(field.minPhotos, `${t.id}/${field.id}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("marks a meaningful number of fields required", () => {
    for (const t of STARTER_TEMPLATES) {
      const required = allFields(t).filter((f) => f.required);
      expect(required.length, t.id).toBeGreaterThanOrEqual(5);
    }
  });

  it("demonstrates conditionals, and every conditional targets a field in the same template", () => {
    for (const t of STARTER_TEMPLATES) {
      const fields = allFields(t);
      const ids = new Set(fields.map((f) => f.id));
      const conditionals = [
        ...fields.filter((f) => f.conditional),
        ...t.schema.sections.filter((s) => s.conditional),
      ];
      expect(conditionals.length, `${t.id} has no conditional`).toBeGreaterThan(0);
      for (const owner of conditionals) {
        const cond = owner.conditional!;
        // Property-driven conditions have no fieldId — nothing to resolve.
        if (!cond.fieldId) continue;
        expect(ids.has(cond.fieldId), `${t.id}: conditional → unknown field ${cond.fieldId}`).toBe(
          true
        );
      }
    }
  });

  it("survives normalizeFormSchema with every section and field intact", () => {
    for (const t of STARTER_TEMPLATES) {
      const normalized = normalizeFormSchema(t.schema);
      const sectionIds = new Set(normalized.sections.map((s: any) => s.id));
      const fieldIds = new Set(
        normalized.sections.flatMap((s: any) => (s.fields ?? []).map((f: any) => f.id))
      );

      for (const section of t.schema.sections) {
        expect(sectionIds.has(section.id), `${t.id}: lost section ${section.id}`).toBe(true);
        for (const field of section.fields) {
          expect(fieldIds.has(field.id), `${t.id}: lost field ${field.id}`).toBe(true);
        }
      }
      // The normalizer injects the standard sections — it may only ADD.
      expect(normalized.sections.length).toBeGreaterThanOrEqual(t.schema.sections.length);
      // …and it is idempotent, which is what the builder relies on when it
      // re-saves a template created from a blueprint.
      expect(normalizeFormSchema(normalized)).toEqual(normalized);
    }
  });

  it("canonicalises conditionals to the { operator, value } shape", () => {
    for (const t of STARTER_TEMPLATES) {
      const normalized = normalizeFormSchema(t.schema);
      for (const section of normalized.sections as any[]) {
        for (const field of section.fields ?? []) {
          if (!field.conditional?.fieldId) continue;
          expect(typeof field.conditional.operator, `${t.id}/${field.id}`).toBe("string");
        }
      }
    }
  });

  it("looks up by id and reports picker stats", () => {
    const first = STARTER_TEMPLATES[0];
    expect(getStarterTemplate(first.id)).toBe(first);
    expect(getStarterTemplate("does-not-exist")).toBeUndefined();

    const stats = starterTemplateStats(first);
    expect(stats.sections).toBe(first.schema.sections.length);
    expect(stats.fields).toBe(
      first.schema.sections.reduce((sum, s) => sum + s.fields.length, 0)
    );
    expect(stats.photoFields).toBeGreaterThan(0);
  });
});

describe("duplicate-template helpers", () => {
  it("strips an existing copy marker so copies stay flat", () => {
    expect(stripCopySuffix("Bond Clean")).toBe("Bond Clean");
    expect(stripCopySuffix("Bond Clean (Copy)")).toBe("Bond Clean");
    expect(stripCopySuffix("Bond Clean (Copy 4)")).toBe("Bond Clean");
    expect(stripCopySuffix("Bond Clean (copy 12)")).toBe("Bond Clean");
  });

  it("names the first duplicate '(Copy)'", () => {
    expect(duplicateTemplateName("Bond Clean", [])).toBe("Bond Clean (Copy)");
  });

  it("walks past taken names instead of colliding", () => {
    expect(duplicateTemplateName("Bond Clean", ["Bond Clean", "Bond Clean (Copy)"])).toBe(
      "Bond Clean (Copy 2)"
    );
    expect(
      duplicateTemplateName("Bond Clean", [
        "Bond Clean",
        "Bond Clean (Copy)",
        "bond clean (copy 2)",
      ])
    ).toBe("Bond Clean (Copy 3)");
  });

  it("duplicates a copy without stacking suffixes", () => {
    expect(duplicateTemplateName("Bond Clean (Copy)", ["Bond Clean (Copy)"])).toBe(
      "Bond Clean (Copy 2)"
    );
  });

  it("falls back to a placeholder when the source name is empty", () => {
    expect(duplicateTemplateName("   ", [])).toBe("Untitled template (Copy)");
  });

  it("allocates the next version from the highest existing one", () => {
    expect(nextTemplateVersion([])).toBe(1);
    expect(nextTemplateVersion([1, 2, 5])).toBe(6);
    // Order-independent, and a gap does not reset the counter.
    expect(nextTemplateVersion([7, 2])).toBe(8);
    expect(nextTemplateVersion([Number.NaN, 3])).toBe(4);
  });
});
