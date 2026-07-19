import { describe, it, expect } from "vitest";
import { normalizeFormSchema } from "@/lib/forms/normalize-schema";
import { collectRequiredUploadFields } from "@/lib/forms/visibility";

const legacy = {
  sections: [
    {
      // legacy heading key + missing id
      label: "Kitchen",
      fields: [
        { id: "k1", type: "checkbox", label: "Benchtops wiped" },
        // legacy media alias + legacy conditional shape
        { id: "k2", type: "upload", label: "Proof", conditional: { fieldId: "k1", equals: true } },
        // legacy long-text alias, no id
        { type: "textarea", label: "Notes" },
      ],
    },
  ],
};

describe("normalizeFormSchema — canonicalisation", () => {
  const out = normalizeFormSchema(legacy);
  const kitchen = out.sections.find((s: any) => s.title === "Kitchen");

  it("maps section label → title and backfills a section id", () => {
    expect(kitchen).toBeTruthy();
    expect(kitchen.title).toBe("Kitchen");
    expect(typeof kitchen.id).toBe("string");
    expect(kitchen.id.length).toBeGreaterThan(0);
  });

  it("aliases upload → photo and textarea → longtext", () => {
    const types = kitchen.fields.map((f: any) => f.type);
    expect(types).toContain("photo"); // was upload
    expect(types).toContain("longtext"); // was textarea
    expect(types).not.toContain("upload");
    expect(types).not.toContain("textarea");
  });

  it("rewrites legacy {equals} conditional to {operator,value}", () => {
    const proof = kitchen.fields.find((f: any) => f.id === "k2");
    expect(proof.conditional).toEqual({ fieldId: "k1", operator: "equals", value: true });
  });

  it("backfills a field id when missing", () => {
    const notes = kitchen.fields.find((f: any) => f.type === "longtext");
    expect(typeof notes.id).toBe("string");
    expect(notes.id.length).toBeGreaterThan(0);
  });
});

describe("normalizeFormSchema — standard sections + idempotence", () => {
  it("adds arrival evidence + exception report + sign-off to a non-empty schema", () => {
    const out = normalizeFormSchema(legacy);
    const ids = out.sections.map((s: any) => s.id);
    expect(ids).toContain("arrival-evidence");
    expect(ids).toContain("reported-exceptions-section");
    expect(ids).toContain("sign-off");
  });

  it("is idempotent (double application == single) — no duplicated standard sections", () => {
    const once = normalizeFormSchema(legacy);
    const twice = normalizeFormSchema(once);
    expect(JSON.stringify(twice.sections)).toEqual(JSON.stringify(once.sections));
    const arrivalCount = twice.sections.filter((s: any) => s.id === "arrival-evidence").length;
    expect(arrivalCount).toBe(1);
  });

  it("leaves an empty schema empty (no phantom standard sections)", () => {
    expect(normalizeFormSchema({ sections: [] }).sections).toEqual([]);
    expect(normalizeFormSchema(null).sections).toEqual([]);
  });
});

describe("normalizeFormSchema — read/submit required-set parity", () => {
  it("the normalized schema enforces the standard required uploads", () => {
    // This is the crux of the 'Next → uploads error' fix: the read route and the
    // submit route both normalize, so both see the SAME required upload set.
    const out = normalizeFormSchema(legacy);
    const required = collectRequiredUploadFields(out, {}, {}, undefined).map((f) => f.id);
    expect(required).toContain("arrival-evidence.walkthrough-video");
    expect(required).toContain("arrival-evidence.before-photos");
  });

  it("produces the identical required set whether or not the raw schema pre-baked standard sections", () => {
    const raw = normalizeFormSchema(legacy); // already has standard sections baked in
    const rawAgain = normalizeFormSchema({ sections: raw.sections }); // simulate submit reading the stored (baked) schema
    const a = collectRequiredUploadFields(raw, {}, {}, undefined).map((f) => f.id).sort();
    const b = collectRequiredUploadFields(rawAgain, {}, {}, undefined).map((f) => f.id).sort();
    expect(a).toEqual(b);
  });
});
