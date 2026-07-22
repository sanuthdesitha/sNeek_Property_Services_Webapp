import { describe, it, expect } from "vitest";
import { lintTemplateSchema, hasBlockingIssues } from "@/lib/forms/lint-template";

const rules = (schema: unknown) => lintTemplateSchema(schema).map((i) => i.rule);

describe("lintTemplateSchema", () => {
  it("passes a clean schema", () => {
    const issues = lintTemplateSchema({
      sections: [
        {
          id: "kitchen",
          title: "Kitchen",
          fields: [
            { id: "k1", type: "checkbox", label: "Benchtops" },
            {
              id: "k2",
              type: "photo",
              label: "Proof",
              required: true,
              minPhotos: 1,
              conditional: { fieldId: "k1", operator: "equals", value: true },
            },
          ],
        },
      ],
    });
    expect(issues).toEqual([]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("flags duplicate field ids as blocking", () => {
    const issues = lintTemplateSchema({
      sections: [
        {
          id: "s1",
          title: "S1",
          fields: [
            { id: "dup", type: "text", label: "A" },
            { id: "dup", type: "text", label: "B" },
          ],
        },
      ],
    });
    expect(issues.map((i) => i.rule)).toContain("duplicate-field-id");
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("flags duplicate section ids as blocking", () => {
    const issues = lintTemplateSchema({
      sections: [
        { id: "same", title: "A", fields: [{ id: "a", type: "text", label: "A" }] },
        { id: "same", title: "B", fields: [{ id: "b", type: "text", label: "B" }] },
      ],
    });
    expect(issues.map((i) => i.rule)).toContain("duplicate-section-id");
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("flags a conditional referencing a missing fieldId", () => {
    const issues = lintTemplateSchema({
      sections: [
        {
          id: "s1",
          title: "S1",
          fields: [
            {
              id: "a",
              type: "photo",
              label: "A",
              conditional: { fieldId: "ghost", operator: "equals", value: true },
            },
          ],
        },
      ],
    });
    const rule = issues.find((i) => i.rule === "conditional-missing-field");
    expect(rule?.severity).toBe("error");
    expect(rule?.message).toContain("ghost");
  });

  it("resolves conditionals that point at a CHILD field", () => {
    const found = rules({
      sections: [
        {
          id: "s1",
          title: "S1",
          fields: [
            {
              id: "a",
              type: "checkbox",
              label: "A",
              children: [{ id: "a__proof", type: "photo", label: "Proof", minPhotos: 1 }],
            },
            {
              id: "b",
              type: "text",
              label: "B",
              conditional: { fieldId: "a__proof", operator: "answered" },
            },
          ],
        },
      ],
    });
    expect(found).not.toContain("conditional-missing-field");
  });

  it("flags a required upload with minPhotos 0", () => {
    const issues = lintTemplateSchema({
      sections: [
        {
          id: "s1",
          title: "S1",
          fields: [{ id: "p", type: "photo", label: "Photo", required: true, minPhotos: 0 }],
        },
      ],
    });
    expect(issues.map((i) => i.rule)).toContain("required-upload-zero-min");
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("warns on an empty section", () => {
    const issues = lintTemplateSchema({ sections: [{ id: "s1", title: "S1", fields: [] }] });
    const empty = issues.find((i) => i.rule === "empty-section");
    expect(empty?.severity).toBe("warning");
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("warns on legacy shapes (label heading, upload/textarea types, {equals} conditional)", () => {
    const found = rules({
      sections: [
        {
          id: "s1",
          label: "Legacy heading",
          fields: [
            { id: "a", type: "checkbox", label: "A" },
            { id: "b", type: "upload", label: "B", conditional: { fieldId: "a", equals: true } },
            { id: "c", type: "textarea", label: "C" },
          ],
        },
      ],
    });
    expect(found).toContain("legacy-section-heading");
    expect(found).toContain("legacy-field-type");
    expect(found).toContain("legacy-conditional");
  });

  it("never throws on a malformed schema", () => {
    expect(rules(null)).toContain("missing-sections");
    expect(rules({ sections: "nope" })).toContain("missing-sections");
    expect(() => lintTemplateSchema({ sections: [null, 1, { id: "s", fields: [null] }] })).not.toThrow();
  });
});
