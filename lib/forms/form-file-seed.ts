import "server-only";
/**
 * Create the forms of a hand-authored form file (docs/forms/*.json, the Forms
 * library export format) as DRAFTS, once.
 *
 *  - Goes through the library's own import (importFormTemplates): the same
 *    strict check, a new row with isActive false, never published, never
 *    changing an existing form or which form any job uses.
 *  - Idempotent by name: a form whose name already exists (any letter case,
 *    any state) is skipped, so re-running creates nothing new and never adds
 *    an "(imported)" copy.
 *  - Stock count questions written with a SKU are bound to this database's
 *    active inventory item first (stock-item-binding.ts). A SKU with no item
 *    stops the run unless `allowMissingStock` is set; then the question keeps
 *    its SKU and its counts go to office review.
 */
import { db } from "@/lib/db";
import { bindStockCountItemsBySku, type StockBindingEntry, type StockBindingMissing } from "./stock-item-binding";
import { TemplateServiceError } from "./template-errors";
import { isNode } from "./template-questions";
import { importFormTemplates, type ImportOutcome } from "./template-transfer-server";

export type FormFileSeedInput = {
  text: string;
  actorId: string;
  dryRun: boolean;
  allowMissingStock?: boolean;
};

export type FormFileSeedForm = {
  name: string;
  status: "skipped-existing" | "would-create" | "created" | "refused";
  existingId?: string;
  createdId?: string;
  reason?: string;
  bound: StockBindingEntry[];
  missing: StockBindingMissing[];
};

export type FormFileSeedResult = { dryRun: boolean; forms: FormFileSeedForm[] };

type FileForm = Record<string, unknown> & { name?: unknown; schema?: unknown };

function readFile(text: string): { root: Record<string, unknown>; forms: FileForm[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TemplateServiceError("INVALID_SCHEMA", "The form file is not valid JSON.");
  }
  if (!isNode(parsed) || !Array.isArray(parsed.forms)) {
    throw new TemplateServiceError("INVALID_SCHEMA", "The form file holds no forms.");
  }
  return { root: parsed, forms: parsed.forms.filter(isNode) as FileForm[] };
}

function outcomeFor(outcome: ImportOutcome, index: number) {
  return outcome.forms.find((form) => form.index === index);
}

export async function seedFormFileAsDrafts(input: FormFileSeedInput): Promise<FormFileSeedResult> {
  const { root, forms } = readFile(input.text);
  const [existing, items] = await Promise.all([
    db.formTemplate.findMany({ select: { id: true, name: true } }),
    db.inventoryItem.findMany({ select: { id: true, sku: true, name: true, unit: true, isActive: true } }),
  ]);
  const existingByName = new Map(existing.map((row) => [row.name.trim().toLowerCase(), row.id]));

  const results: FormFileSeedForm[] = [];
  const toImport: Array<{ resultIndex: number; form: FileForm }> = [];
  for (const form of forms) {
    const name = typeof form.name === "string" ? form.name.trim() : "";
    const existingId = existingByName.get(name.toLowerCase());
    if (existingId) {
      results.push({ name, status: "skipped-existing", existingId, bound: [], missing: [] });
      continue;
    }
    const binding = bindStockCountItemsBySku(form.schema, items);
    if (binding.missing.length > 0 && !input.allowMissingStock) {
      const references = binding.missing.map((entry) => entry.reference || "(none)").join(", ");
      results.push({ name, status: "refused", reason: `No active inventory item for: ${references}.`, bound: binding.bound, missing: binding.missing });
      continue;
    }
    results.push({ name, status: input.dryRun ? "would-create" : "created", bound: binding.bound, missing: binding.missing });
    toImport.push({ resultIndex: results.length - 1, form: { ...form, schema: binding.schema } });
  }

  if (toImport.length === 0) return { dryRun: input.dryRun, forms: results };

  const text = JSON.stringify({ ...root, forms: toImport.map((entry) => entry.form) });
  const outcome = await importFormTemplates({ text, dryRun: input.dryRun, actorId: input.actorId });
  toImport.forEach((entry, index) => {
    const imported = outcomeFor(outcome, index);
    const result = results[entry.resultIndex];
    if (!imported || imported.refused) {
      result.status = "refused";
      result.reason = imported?.refused ?? "The import did not report this form.";
      return;
    }
    if (imported.createdId) result.createdId = imported.createdId;
  });
  return { dryRun: input.dryRun, forms: results };
}
