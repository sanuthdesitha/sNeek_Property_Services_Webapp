import { describe, expect, it } from "vitest";
import { checkTemplateSchema, checkTemplateWithDraft } from "@/lib/forms/template-checks";
import { addSection, editQuestion, findAndReplace } from "@/lib/forms/template-bulk-edits";
import { buildQuestionIndex, countQuestions, findQuestion, searchableQuestionText } from "@/lib/forms/template-questions";

function schema() {
  return {
    standardSections: false,
    sections: [
      { id: "arrival-evidence", title: "Arrival", fields: [{ id: "arrive", type: "photo", label: "Front door", required: true, minPhotos: 1 }] },
      {
        id: "kitchen",
        title: "Kitchen",
        fields: [
          { id: "oven", type: "photo", label: "Oven cleaned inside", required: true, minPhotos: 1 },
          { id: "bins", type: "yesno", label: "Bins emptied", required: true, children: [{ id: "bins-note", type: "text", label: "Bin note" }] },
          { id: "state", type: "select", label: "Oven state", options: ["Clean", "Dirty"] },
          { id: "dirty-why", type: "text", label: "Why dirty", conditional: { fieldId: "state", operator: "equals", value: "Dirty" } },
          { id: "tip", type: "instruction", label: "Use the oven spray" },
        ],
      },
      { id: "sign-off", title: "Sign-off", fields: [{ id: "sig", type: "signature", label: "Signature", required: true }] },
    ],
  };
}

describe("checks", () => {
  it("passes a clean schema and reports registry problems with severities", () => {
    expect(checkTemplateSchema(schema()).status).toBe("pass");
    const broken = schema();
    broken.sections[1].fields.push({ id: "mystery", type: "hologram", label: "Mystery" } as never);
    broken.sections[1].fields.push({ id: "pick", type: "radio", label: "Pick one" } as never);
    const result = checkTemplateSchema(broken);
    expect(result.status).toBe("errors");
    expect(result.issues.find((i) => i.rule === "unknown-field-type")).toMatchObject({ severity: "error", fieldId: "mystery" });
    expect(result.issues.find((i) => i.rule === "choice-without-options")).toMatchObject({ severity: "warning", fieldId: "pick" });
  });

  it("reports structure and lint errors and never throws on garbage", () => {
    expect(checkTemplateSchema(null).status).toBe("errors");
    const dup = schema();
    dup.sections[1].fields[1].id = "oven";
    expect(checkTemplateSchema(dup).issues.some((i) => i.rule === "duplicate-field-id" && i.severity === "error")).toBe(true);
  });

  it("checks the draft too, prefixed, so a broken draft is visible", () => {
    const draft = schema();
    draft.sections[1].fields.push({ id: "x", type: "nope", label: "X" } as never);
    const result = checkTemplateWithDraft(schema(), draft);
    expect(result.errors).toBe(1);
    expect(result.issues[0].message.startsWith("Draft: ")).toBe(true);
  });
});

describe("question matching", () => {
  it("matches by id or by section + label + type, ignoring case and spacing", () => {
    expect(findQuestion(schema(), { kind: "fieldId", fieldId: "bins-note" })).toMatchObject({ ok: true });
    const byWording = findQuestion(schema(), { kind: "wording", section: " kitchen ", label: "OVEN  cleaned inside", type: "photo" });
    expect(byWording.ok && byWording.location.field.id).toBe("oven");
    expect(findQuestion(schema(), { kind: "wording", section: "Kitchen", label: "Oven cleaned inside", type: "checkbox" }).ok).toBe(false);
  });

  it("never guesses between two matches", () => {
    const twice = schema();
    twice.sections[1].fields.push({ id: "oven-2", type: "photo", label: "Oven cleaned inside", required: true, minPhotos: 1 });
    const result = findQuestion(twice, { kind: "wording", section: "Kitchen", label: "Oven cleaned inside", type: "photo" });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/appears 2 times/);
  });

  it("indexes questions across forms with presence counts", () => {
    const other = schema();
    other.sections[1].fields = other.sections[1].fields.filter((f) => f.id !== "oven");
    const index = buildQuestionIndex([schema(), other]);
    expect(index.find((q) => q.match.label === "Oven cleaned inside")).toMatchObject({ formCount: 1, repeatedIn: 0 });
    expect(index.find((q) => q.match.label === "Bins emptied")).toMatchObject({ formCount: 2 });
  });

  it("counts answerable questions and searches labels", () => {
    expect(countQuestions(schema())).toBe(7);
    expect(searchableQuestionText(schema())).toContain("oven cleaned inside");
  });
});

describe("bulk edits", () => {
  it("edits one property, records before/after and does not mutate the input", () => {
    const input = schema();
    const frozen = JSON.stringify(input);
    const result = editQuestion(input, { kind: "wording", section: "Kitchen", label: "Oven cleaned inside", type: "photo" }, { property: "minPhotos", value: 2 });
    expect(JSON.stringify(input)).toBe(frozen);
    expect(result.changed).toBe(true);
    if (!result.changed) return;
    expect(result.changes).toEqual([{ sectionTitle: "Kitchen", fieldId: "oven", fieldLabel: "Oven cleaned inside", property: "minPhotos", before: 1, after: 2 }]);
  });

  it("explains forms it leaves unchanged", () => {
    expect(editQuestion(schema(), { kind: "fieldId", fieldId: "bins" }, { property: "minPhotos", value: 2 })).toMatchObject({ changed: false, reason: expect.stringContaining("takes no photos") });
    expect(editQuestion(schema(), { kind: "fieldId", fieldId: "oven" }, { property: "minPhotos", value: 1 })).toMatchObject({ changed: false, reason: "Already set to that value." });
    expect(editQuestion(schema(), { kind: "fieldId", fieldId: "gone" }, { property: "required", value: true })).toMatchObject({ changed: false });
  });

  it("refuses an edit that would add a validation error", () => {
    const result = editQuestion(schema(), { kind: "fieldId", fieldId: "oven" }, { property: "minPhotos", value: 0 });
    expect(result).toMatchObject({ changed: false, reason: expect.stringContaining("would add a problem") });
  });

  it("adds a section with fresh ids before the trailing standard sections", () => {
    const result = addSection(schema(), { title: "Oven", questions: ["Racks soaked", "Oven cleaned inside"], position: "end" });
    expect(result.changed).toBe(true);
    if (!result.changed) return;
    const sections = result.schema.sections as Array<{ id: string; title: string; fields: Array<{ id: string }> }>;
    expect(sections.map((s) => s.id)).toEqual(["arrival-evidence", "kitchen", "s-oven", "sign-off"]);
    const ids = sections.flatMap((s) => [s.id, ...s.fields.map((f) => f.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(addSection(schema(), { title: "kitchen", questions: [], position: "start" })).toMatchObject({ changed: false });
  });

  it("find and replace changes wording only, never ids", () => {
    const result = findAndReplace(schema(), { find: "oven", replace: "Stove", matchCase: false });
    expect(result.changed).toBe(true);
    if (!result.changed) return;
    const before = JSON.stringify(schema().sections.map((s) => [s.id, s.fields.map((f) => f.id)]));
    const sections = result.schema.sections as Array<{ id: string; fields: Array<{ id: string; label: string }> }>;
    expect(JSON.stringify(sections.map((s) => [s.id, s.fields.map((f) => f.id)]))).toBe(before);
    expect(sections[1].fields[0]).toMatchObject({ id: "oven", label: "Stove cleaned inside" });
    expect(result.changes.every((c) => c.property !== "id")).toBe(true);
  });

  it("does not rename an option a condition depends on", () => {
    const result = findAndReplace(schema(), { find: "Dirty", replace: "Soiled", matchCase: true });
    expect(result).toMatchObject({ changed: false, reason: expect.stringContaining("used by a condition") });
  });
});
