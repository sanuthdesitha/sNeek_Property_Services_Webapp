// Wave B: Table and Stock count rules, question effects, their strict save
// checks and what "Test as cleaner" says would happen (it does none of it).
import { describe, expect, it } from "vitest";
import { tableAnswerError, stockCountAnswerError, formatTableAnswer, tableAnswerGrid, formatStockCountAnswer } from "@/lib/forms/structured-answers";
import { collectStructuredAnswerErrors } from "@/lib/forms/validate-submission";
import { validateFormSchemaForSave } from "@/lib/forms/template-schema";
import { checkTemplateSchema } from "@/lib/forms/template-checks";
import { planSubmissionEffects, wouldHappenSentence, effectBadgeLabel } from "@/lib/forms/form-effects";
import { questionBadges, buildBadgeContext } from "@/lib/forms/question-badges";
import { runFormTest } from "@/lib/forms/test-run";
import type { FormField } from "@/lib/forms/types";

const fixed = { type: "table", required: true, table: { columns: [{ id: "c1", label: "Clean", cellType: "yesno", required: true }, { id: "c2", label: "Note", cellType: "text" }], rowMode: "fixed", rowLabels: ["Fridge", "Oven"] } };
const dynamic = { type: "table", table: { columns: [{ id: "c1", label: "Item", cellType: "choice", options: ["Towel", "Sheet"], required: true }, { id: "c2", label: "Count", cellType: "number" }], rowMode: "dynamic", minRows: 2, maxRows: 3 } };
const schema = (fields: unknown[]) => ({ sections: [{ id: "s", title: "Kitchen", fields }] });

describe("table answers", () => {
  it("fixed rows: exactly the labelled rows, required cells per row", () => {
    expect(tableAnswerError(fixed, [{ c1: true }, { c1: false, c2: "door seal" }])).toBeNull();
    expect(tableAnswerError(fixed, [{ c1: true }])).toMatch(/2 rows/);
    expect(tableAnswerError(fixed, [{ c1: true }, { c2: "x" }])).toMatch(/Row 2: "Clean" is required/);
    expect(tableAnswerError(fixed, undefined)).toBe("Fill in the table.");
  });
  it("cleaner-added rows: limits, cell types, unknown columns", () => {
    expect(tableAnswerError(dynamic, undefined)).toBeNull();
    expect(tableAnswerError(dynamic, [{ c1: "Towel" }])).toMatch(/at least 2/);
    expect(tableAnswerError(dynamic, [{ c1: "Towel" }, { c1: "Sheet", c2: 2 }])).toBeNull();
    expect(tableAnswerError(dynamic, Array.from({ length: 4 }, () => ({ c1: "Towel" })))).toMatch(/at most 3/);
    expect(tableAnswerError(dynamic, [{ c1: "Blanket" }, { c1: "Towel" }])).toMatch(/one of its choices/);
    expect(tableAnswerError(dynamic, [{ c1: "Towel", c2: "2" }, { c1: "Towel" }])).toMatch(/number/);
    expect(tableAnswerError(dynamic, [{ c9: "x" }])).toMatch(/no column "c9"/);
  });
  it("reads well in reports", () => {
    expect(formatTableAnswer(fixed, [{ c1: true }, { c1: false, c2: "seal" }])).toBe("Fridge — Clean: Yes · Note: –\nOven — Clean: No · Note: seal");
    expect(tableAnswerGrid(fixed, [{ c1: true }, { c1: false }])).toEqual({ columns: ["Row", "Clean", "Note"], rows: [["Fridge", "Yes", "–"], ["Oven", "No", "–"]] });
    expect(formatTableAnswer(fixed, [])).toBe("-");
  });
});

describe("stock count answers", () => {
  const field = { type: "stock_count", stockItemId: "tabs", required: true, unit: "tablets", stockItemName: "Tablets" };
  it("needs the question's item and a whole number from 0", () => {
    expect(stockCountAnswerError(field, { itemId: "tabs", count: 0 })).toBeNull();
    expect(stockCountAnswerError(field, { itemId: "tabs" })).toBe("Enter the count.");
    expect(stockCountAnswerError(field, { itemId: "tabs", count: -1 })).toMatch(/whole number/);
    expect(stockCountAnswerError(field, { itemId: "soap", count: 1 })).toMatch(/different item/);
    expect(formatStockCountAnswer(field, { itemId: "tabs", count: 4 })).toBe("4 tablets (Tablets)");
  });
  it("is enforced only for visible questions", () => {
    const hidden = { id: "q", label: "Q", ...field, conditional: { fieldId: "x", operator: "equals", value: true } };
    expect(collectStructuredAnswerErrors(schema([hidden]), {}, {})).toEqual([]);
    expect(collectStructuredAnswerErrors(schema([{ id: "q", label: "Q", ...field }]), {}, {})[0]).toMatchObject({ fieldId: "q", rule: "stock-count" });
  });
});

describe("strict save checks and Checks", () => {
  const base = { id: "q", label: "Count tabs" };
  it("refuses a stock count without an item, a table without columns, an effect on the wrong type", () => {
    expect(validateFormSchemaForSave(schema([{ ...base, type: "stock_count" }])).ok).toBe(false);
    expect(validateFormSchemaForSave(schema([{ ...base, type: "table", table: { columns: [], rowMode: "dynamic" } }])).ok).toBe(false);
    expect(validateFormSchemaForSave(schema([{ ...base, type: "text", effects: [{ kind: "urgent-stock-below", threshold: 3 }] }])).ok).toBe(false);
    expect(validateFormSchemaForSave(schema([{ ...base, type: "stock_count", stockItemId: "t", effects: [{ kind: "urgent-stock-below", threshold: 0 }] }])).ok).toBe(false);
    expect(validateFormSchemaForSave(schema([{ ...base, type: "yesno", effects: [{ kind: "damage-report", when: "maybe" }] }])).ok).toBe(false);
    expect(validateFormSchemaForSave(schema([{ ...base, type: "stock_count", stockItemId: "t", effects: [{ kind: "urgent-stock-below", threshold: 3 }] }])).ok).toBe(true);
    expect(validateFormSchemaForSave(schema([{ ...base, type: "yesno", effects: [{ kind: "damage-report", when: "yes" }] }])).ok).toBe(true);
  });
  it("refuses two stock counts of the same item and shows it as a check error", () => {
    const twice = schema([{ id: "a", label: "A", type: "stock_count", stockItemId: "t" }, { id: "b", label: "B", type: "stock_count", stockItemId: "t" }]);
    expect(validateFormSchemaForSave(twice).ok).toBe(false);
    expect(checkTemplateSchema(twice).issues.some((issue) => issue.rule === "duplicate-stock-count" && issue.severity === "error")).toBe(true);
    expect(checkTemplateSchema(schema([{ ...base, type: "stock_count" }])).errors).toBeGreaterThan(0);
  });
});

describe("the builder's draft keeps a question still being set up (owner report 2026-11-13)", () => {
  // Production: "The draft was not saved. … is a Stock count that does not say
  // which item it counts." while a Stock count was being set up. A new Stock
  // count has no item until one is picked, so every autosave was refused.
  const stockWithoutItem = schema([{ id: "q", label: "Supplies replenished (soap, shampoo)", type: "stock_count" }]);
  it("accepts a Stock count without its item, a choice column without choices and a fixed table without rows for the draft only", () => {
    expect(validateFormSchemaForSave(stockWithoutItem, { allowIncomplete: true })).toEqual({ ok: true, issues: [] });
    const unfinishedTable = schema([{ id: "t", label: "Linen", type: "table", table: { columns: [{ id: "c1", label: "", cellType: "choice" }], rowMode: "fixed", rowLabels: [] } }]);
    expect(validateFormSchemaForSave(unfinishedTable, { allowIncomplete: true }).ok).toBe(true);
    expect(validateFormSchemaForSave(unfinishedTable).ok).toBe(false);
    const strict = validateFormSchemaForSave(stockWithoutItem);
    expect(strict.ok).toBe(false);
    expect(strict.issues[0].message).toBe('"Supplies replenished (soap, shampoo)" is a Stock count that does not say which item it counts.');
  });
  it("still refuses what is malformed, not unfinished, even for the draft", () => {
    const allow = { allowIncomplete: true };
    expect(validateFormSchemaForSave(schema([{ id: "q", label: "Q", type: "stock_count", stockItemId: "t", effects: [{ kind: "urgent-stock-below", threshold: 0 }] }]), allow).ok).toBe(false);
    expect(validateFormSchemaForSave(schema([{ id: "q", label: "Q", type: "table", table: { columns: [], rowMode: "dynamic" } }]), allow).ok).toBe(false);
    expect(validateFormSchemaForSave(schema([{ id: "q", label: "Q", type: "nonsense" }]), allow).ok).toBe(false);
    const twice = schema([{ id: "a", label: "A", type: "stock_count", stockItemId: "t" }, { id: "b", label: "B", type: "stock_count", stockItemId: "t" }]);
    expect(validateFormSchemaForSave(twice, allow).ok).toBe(false);
  });
  it("keeps it a check error, so the form cannot be published until the item is chosen (publish: form-schema-save-and-publish)", () => {
    const result = checkTemplateSchema(stockWithoutItem);
    expect(result.issues.some((issue) => issue.rule === "question-setup" && issue.severity === "error" && issue.fieldId === "q")).toBe(true);
  });
});

describe("question effects", () => {
  const stock = { id: "tabs", label: "Tablets left", type: "stock_count", stockItemId: "tabs", unit: "tablets", effects: [{ kind: "urgent-stock-below", threshold: 3 }] };
  const damage = { id: "dmg", label: "Anything damaged?", type: "yesno", effects: [{ kind: "damage-report", when: "yes", area: "Kitchen bench" }] };
  it("raises below N only, never at or above it", () => {
    expect(planSubmissionEffects(schema([stock]), { tabs: { itemId: "tabs", count: 2 } }, {}).urgentStock).toHaveLength(1);
    expect(planSubmissionEffects(schema([stock]), { tabs: { itemId: "tabs", count: 3 } }, {}).urgentStock).toHaveLength(0);
    expect(planSubmissionEffects(schema([stock]), { tabs: { itemId: "tabs", count: 9 } }, {}).urgentStock).toHaveLength(0);
  });
  it("damage on the configured answer only, area prefilled", () => {
    expect(planSubmissionEffects(schema([damage]), { dmg: true }, {}).damage).toEqual([expect.objectContaining({ fieldId: "dmg", area: "Kitchen bench" })]);
    expect(planSubmissionEffects(schema([damage]), { dmg: false }, {}).damage).toEqual([]);
    const onNo = { ...damage, effects: [{ kind: "damage-report", when: "no" }] };
    expect(planSubmissionEffects(schema([onNo]), { dmg: false }, {}).damage[0].area).toBe("Kitchen");
  });
  it("ignores a hidden question's stale answer and counts each item once", () => {
    const hidden = { ...stock, conditional: { fieldId: "dmg", operator: "equals", value: true } };
    expect(planSubmissionEffects(schema([damage, hidden]), { dmg: false, tabs: { itemId: "tabs", count: 0 } }, {}).stockCounts).toEqual([]);
    const second = { ...stock, id: "tabs2" };
    expect(planSubmissionEffects(schema([stock, second]), { tabs: { itemId: "tabs", count: 1 }, tabs2: { itemId: "tabs", count: 0 } }, {}).stockCounts).toHaveLength(1);
  });
  it("badges and wording say exactly what happens", () => {
    expect(effectBadgeLabel({ kind: "urgent-stock-below", threshold: 3 })).toBe("Raises urgent stock below 3");
    expect(effectBadgeLabel({ kind: "damage-report", when: "yes" })).toBe('"Yes" opens a damage report');
    const labels = questionBadges(damage as FormField, buildBadgeContext(schema([damage]) as never)).map((badge) => badge.label);
    expect(labels).toContain('"Yes" opens a damage report');
    expect(questionBadges({ id: "m", label: "M", type: "text", frequency: "MONTHLY" }, buildBadgeContext(schema([]) as never)).map((b) => b.label)).toContain("Monthly");
  });
  it("Test as cleaner reports what WOULD happen and writes nothing (pure, no services)", () => {
    const result = runFormTest({ schema: schema([stock, damage]), answers: { tabs: { itemId: "tabs", count: 1 }, dmg: true }, uploadCounts: {}, property: {}, requiredChecklistTicksBlockSubmit: false });
    expect(result.wouldHappen).toEqual([
      expect.stringContaining("Would raise an urgent stock need"),
      expect.stringContaining("Would open a damage report"),
    ]);
    expect(wouldHappenSentence({ stockCounts: [], urgentStock: [], damage: [] })).toEqual([]);
  });
});
