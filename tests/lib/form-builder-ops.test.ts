import { describe, expect, it } from "vitest";
import {
  copyFieldsWithNewIds,
  deleteFields,
  duplicateFields,
  moveFieldBy,
  moveFieldsToSection,
  moveSectionBy,
  reorderField,
  reorderSection,
  type IdFactory,
} from "@/lib/forms/builder-ops";
import { applyDrop, fieldDragId, sectionDragId } from "@/lib/forms/builder-dnd";
import { applyMultiEdit, multiEditKeysFor, sharedValue } from "@/lib/forms/multi-edit";
import { canRedo, canUndo, createHistory, historyShortcut, pushHistory, redo, undo } from "@/lib/forms/builder-history";
import { diffFormVersions } from "@/lib/forms/version-diff";
import { expandRepeatedSections } from "@/lib/forms/repeat-sections";
import { buildBadgeContext, questionBadges } from "@/lib/forms/question-badges";
import { insertQuestions } from "@/lib/forms/template-bulk-insert";
import type { FormField, FormSchema } from "@/lib/forms/types";

const ids = (): IdFactory => {
  let n = 0;
  return (kind) => `${kind}-new-${++n}`;
};

const schema = (): FormSchema => ({
  sections: [
    { id: "a", title: "Arrival", fields: [{ id: "a1", type: "checkbox", label: "Keys" }, { id: "a2", type: "photo", label: "Door", minPhotos: 1 }] },
    {
      id: "k",
      title: "Kitchen",
      fields: [
        { id: "oven", type: "yesno", label: "Oven cleaned", required: true },
        { id: "ovenPhoto", type: "photo", label: "Oven photo", minPhotos: 1, conditional: { fieldId: "oven", operator: "equals", value: true } },
        { id: "fridge", type: "photo", label: "Fridge photo", minPhotos: 2, conditional: { fieldId: "a1", operator: "answered" } },
      ],
    },
  ],
});

const fieldIds = (s: FormSchema) => s.sections.map((section) => section.fields.map((field) => field.id));

describe("move and reorder (drag and drop + row menu)", () => {
  it("reorders sections and moves a section by one", () => {
    expect(reorderSection(schema(), "k", "a").sections.map((s) => s.id)).toEqual(["k", "a"]);
    expect(moveSectionBy(schema(), "a", 1).sections.map((s) => s.id)).toEqual(["k", "a"]);
    expect(moveSectionBy(schema(), "a", -1).sections.map((s) => s.id)).toEqual(["a", "k"]);
  });

  it("reorders within a section, moves across sections, and keeps the input untouched", () => {
    const input = schema();
    expect(fieldIds(reorderField(input, "fridge", "oven"))).toEqual([["a1", "a2"], ["fridge", "oven", "ovenPhoto"]]);
    expect(fieldIds(reorderField(input, "a1", "oven"))).toEqual([["a2"], ["a1", "oven", "ovenPhoto", "fridge"]]);
    expect(fieldIds(moveFieldBy(input, "oven", 1))).toEqual([["a1", "a2"], ["ovenPhoto", "oven", "fridge"]]);
    expect(fieldIds(moveFieldBy(input, "oven", -1))).toEqual(fieldIds(input));
    expect(fieldIds(input)).toEqual([["a1", "a2"], ["oven", "ovenPhoto", "fridge"]]);
  });

  it("moves several questions to another section in document order", () => {
    // Moved in document order (a1 before fridge), appended after the questions that stay.
    expect(fieldIds(moveFieldsToSection(schema(), ["fridge", "a1"], "k"))).toEqual([["a2"], ["oven", "ovenPhoto", "a1", "fridge"]]);
    expect(fieldIds(moveFieldsToSection(schema(), ["oven"], "a", 0))).toEqual([["oven", "a1", "a2"], ["ovenPhoto", "fridge"]]);
  });

  it("applies drops: section on section, question on outline section, selection travels together", () => {
    expect(applyDrop(schema(), sectionDragId("k"), sectionDragId("a")).sections[0].id).toBe("k");
    expect(fieldIds(applyDrop(schema(), fieldDragId("a1"), sectionDragId("k")))).toEqual([["a2"], ["oven", "ovenPhoto", "fridge", "a1"]]);
    expect(fieldIds(applyDrop(schema(), fieldDragId("a1"), sectionDragId("k"), ["a1", "a2"]))).toEqual([[], ["oven", "ovenPhoto", "fridge", "a1", "a2"]]);
    expect(applyDrop(schema(), fieldDragId("a1"), null)).toEqual(schema());
  });
});

describe("copy, duplicate and delete", () => {
  it("copies with new ids, re-points rules inside the set and drops rules that point outside it", () => {
    const fields = schema().sections[1].fields;
    const { fields: copies, droppedRules } = copyFieldsWithNewIds([fields[0], fields[1], fields[2]], ids());
    expect(copies.map((f) => f.id)).toEqual(["field-new-1", "field-new-2", "field-new-3"]);
    expect(copies[1].conditional).toEqual({ fieldId: "field-new-1", operator: "equals", value: true });
    expect(copies[2].conditional).toBeUndefined();
    expect(droppedRules).toEqual([{ questionLabel: "Fridge photo", watchedFieldId: "a1" }]);
  });

  it("gives sub-questions new ids too", () => {
    const parent: FormField = { id: "p", type: "checkbox", label: "P", children: [{ id: "c", type: "text", label: "C", conditional: { fieldId: "p", value: true } }] };
    const [copy] = copyFieldsWithNewIds([parent], ids()).fields;
    expect(copy.children?.[0].id).toBe("field-new-2");
    expect(copy.children?.[0].conditional).toEqual({ fieldId: "field-new-1", value: true });
  });

  it("duplicates in place, keeping rules that watch questions in the same form", () => {
    const result = duplicateFields(schema(), ["fridge"], ids());
    expect(fieldIds(result.schema)[1]).toEqual(["oven", "ovenPhoto", "fridge", "field-new-1"]);
    expect(result.schema.sections[1].fields[3]).toMatchObject({ label: "Fridge photo (copy)", conditional: { fieldId: "a1" } });
  });

  it("reports rules left pointing at a deleted question", () => {
    const { schema: next, danglingRuleLabels } = deleteFields(schema(), ["oven"]);
    expect(fieldIds(next)[1]).toEqual(["ovenPhoto", "fridge"]);
    expect(danglingRuleLabels).toEqual(["Oven photo"]);
  });

  it("copies into another form as a draft edit with collision-free ids and the dropped rule reported", () => {
    const target = { sections: [{ id: "x", title: "kitchen", fields: [{ id: "oven", type: "text", label: "Existing" }] }] };
    const outcome = insertQuestions(target, { sectionTitle: "Kitchen", fields: schema().sections[1].fields });
    expect(outcome.changed).toBe(true);
    if (!outcome.changed) return;
    const added = (outcome.schema.sections as Array<{ fields: FormField[] }>)[0].fields;
    expect(added).toHaveLength(4);
    expect(new Set(added.map((f) => f.id)).size).toBe(4);
    expect(added[2].conditional).toMatchObject({ fieldId: added[1].id });
    expect(outcome.changes.filter((c) => c.property === "rule dropped")).toHaveLength(1);
  });
});

describe("editing several questions together", () => {
  const fields = schema().sections[1].fields;
  it("offers only settings valid for every selected type", () => {
    expect(multiEditKeysFor([fields[1], fields[2]])).toContain("minPhotos");
    expect(multiEditKeysFor([fields[0], fields[1]])).not.toContain("minPhotos");
  });
  it("shows mixed values and writes only what changed", () => {
    expect(sharedValue([fields[1], fields[2]], "minPhotos")).toEqual({ mixed: true });
    expect(sharedValue([fields[1], fields[2]], "required")).toEqual({ mixed: false, value: false });
    const next = applyMultiEdit(schema(), ["ovenPhoto", "fridge"], { maxFiles: 6 });
    expect(next.sections[1].fields[1]).toEqual({ ...fields[1], maxFiles: 6 });
    expect(next.sections[1].fields[2]).toEqual({ ...fields[2], maxFiles: 6 });
  });
  it("sets and clears rotation with the compose/rotation keys", () => {
    const rotated = applyMultiEdit(schema(), ["oven"], { frequency: 3 });
    expect(rotated.sections[1].fields[0]).toMatchObject({ frequency: "ROTATIONAL", rotationEveryNCleans: 3 });
    const every = applyMultiEdit(rotated, ["oven"], { frequency: "every" });
    expect(every.sections[1].fields[0]).toEqual(fields[0]);
  });
});

describe("undo / redo history", () => {
  it("undoes, redoes, coalesces typing and stays bounded", () => {
    let h = createHistory(0, 3);
    h = pushHistory(h, 1);
    h = pushHistory(h, 2, "label");
    h = pushHistory(h, 3, "label");
    expect(h.past).toEqual([0, 1]);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
    for (let i = 4; i < 10; i += 1) h = pushHistory(h, i);
    expect(h.past).toHaveLength(3);
    h = pushHistory(undo(h), 42);
    expect(canRedo(h)).toBe(false);
    expect(canUndo(createHistory(0))).toBe(false);
  });
  it("only claims the shortcut outside text inputs", () => {
    const base = { key: "z", metaKey: false, ctrlKey: true, shiftKey: false };
    expect(historyShortcut({ ...base, target: { tagName: "DIV" } as unknown as EventTarget })).toBe("undo");
    expect(historyShortcut({ ...base, shiftKey: true, target: null })).toBe("redo");
    expect(historyShortcut({ ...base, target: { tagName: "INPUT" } as unknown as EventTarget })).toBeNull();
    expect(historyShortcut({ ...base, ctrlKey: false, target: null })).toBeNull();
  });
});

describe("versions diff", () => {
  it("summarises questions added, removed and changed against live", () => {
    const live = schema();
    const draft = moveFieldsToSection(deleteFields(live, ["a2"]).schema, ["a1"], "k");
    draft.sections[1].fields[0] = { ...draft.sections[1].fields[0], label: "Oven cleaned inside" };
    draft.sections[0].fields.push({ id: "new", type: "text", label: "Notes" });
    const diff = diffFormVersions(live, draft);
    expect(diff.added.map((q) => q.id)).toEqual(["new"]);
    expect(diff.removed.map((q) => q.id)).toEqual(["a2"]);
    expect(diff.changed.find((q) => q.id === "oven")?.changes).toEqual(["wording"]);
    expect(diff.changed.find((q) => q.id === "a1")?.changes).toEqual(["moved from Arrival"]);
    expect(diffFormVersions(live, schema()).identical).toBe(true);
  });
});

describe("per-room repeat", () => {
  const repeated: FormSchema = {
    sections: [{ id: "bed", title: "Bedroom", repeatBy: "bedrooms", fields: [{ id: "made", type: "checkbox", label: "Bed made" }, { id: "pic", type: "photo", label: "Bed photo", conditional: { fieldId: "made", value: true } }] }],
  };
  it("repeats per room with the compose id scheme and re-pointed rules", () => {
    const out = expandRepeatedSections(repeated, { bedrooms: 2 });
    expect(out.sections.map((s) => [s.id, s.title])).toEqual([["bed-1", "Bedroom — Bedroom 1"], ["bed-2", "Bedroom — Bedroom 2"]]);
    expect(out.sections[1].fields.map((f) => f.id)).toEqual(["made__bed2", "pic__bed2"]);
    expect(out.sections[1].fields[1].conditional).toEqual({ fieldId: "made__bed2", value: true });
    expect(expandRepeatedSections(out, { bedrooms: 5 })).toEqual(out);
  });
  it("keeps ids for one room and leaves forms without repeat untouched (same object)", () => {
    expect(expandRepeatedSections(repeated, { bedrooms: 1 }).sections[0].fields[0].id).toBe("made");
    const plain = schema();
    expect(expandRepeatedSections(plain, { bedrooms: 4 })).toBe(plain);
  });
});

describe("question badges are real behaviours only", () => {
  it("shows rotation, rules, watchers, minimum photos, required and the usage check", () => {
    const s = applyMultiEdit(schema(), ["oven"], { frequency: 3 });
    const context = buildBadgeContext(s, ["fridge"]);
    const labels = (id: string) => questionBadges(s.sections.flatMap((x) => x.fields).find((f) => f.id === id)!, context).map((b) => b.label);
    expect(labels("oven")).toEqual(["Every 3rd clean", "\"Yes\" shows 1", "Required"]);
    expect(labels("ovenPhoto")).toEqual(["Shown if \"Oven cleaned\" is Yes", "Min 1"]);
    expect(labels("fridge")).toEqual(["Never answered in 90 days", "Shown if \"Keys\" is answered", "Min 2"]);
    expect(labels("a1")).toEqual(["Controls 1"]);
  });
});
