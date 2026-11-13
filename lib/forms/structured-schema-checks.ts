/**
 * Strict save-time rules for the structured question types (table, stock
 * count) and question effects, shared by validateFormSchemaForSave (refuses
 * the save) and the library/builder Checks (shows the same problem).
 *
 *  - a table has 1…TABLE_MAX_COLUMNS columns with unique ids, a known cell
 *    type, options on choice cells, and sane row limits;
 *  - a stock count names the inventory item it counts;
 *  - an effect sits on the type it belongs to ("urgent-stock-below" on a stock
 *    count with a whole-number threshold ≥ 1; "damage-report" on a Yes / No);
 *  - two stock count questions in one form may not count the same item (a
 *    submission would otherwise hold two counts of one item).
 *
 * Some of these only mean "not finished yet": a Stock count whose item is
 * still to be chosen, a choice column whose choices are still to be typed, a
 * column label being retyped, a fixed-row table whose rows are being retyped.
 * The builder creates exactly those states (a new Stock count has no item
 * until one is picked), so they are marked `incomplete`: the builder's draft
 * autosave keeps them (validateFormSchemaForSave with allowIncomplete) while
 * publishing, copying, importing and saved blocks still refuse them, and the
 * Checks list them as errors that block publishing.
 *
 * PURE.
 */
import { TABLE_CELL_TYPES, TABLE_MAX_COLUMNS, TABLE_MAX_ROWS, STOCK_COUNT_MAX } from "./structured-answers";

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** One structured-question problem; `incomplete` = a setup still being finished (see above). */
export type StructuredFieldFinding = { message: string; incomplete: boolean };

const STOCK_ITEM_MISSING = "is a Stock count that does not say which item it counts.";

function tableFindings(table: unknown): StructuredFieldFinding[] {
  if (!isNode(table)) return [{ message: "is a table with no columns.", incomplete: false }];
  const findings: StructuredFieldFinding[] = [];
  const invalid = (message: string) => findings.push({ message, incomplete: false });
  const unfinished = (message: string) => findings.push({ message, incomplete: true });
  const columns = Array.isArray(table.columns) ? table.columns : [];
  if (columns.length === 0) invalid("is a table with no columns.");
  if (columns.length > TABLE_MAX_COLUMNS) invalid(`has more than ${TABLE_MAX_COLUMNS} table columns.`);
  const ids = new Set<string>();
  for (const column of columns) {
    if (!isNode(column) || typeof column.id !== "string" || !column.id.trim()) {
      invalid("has a table column without a key.");
      continue;
    }
    if (ids.has(column.id)) invalid(`has two table columns with the key "${column.id}".`);
    ids.add(column.id);
    if (typeof column.label !== "string" || !column.label.trim()) unfinished(`has a table column ("${column.id}") without a label.`);
    if (!TABLE_CELL_TYPES.includes(column.cellType as never)) invalid(`has a table column with an unknown cell type (${String(column.cellType)}).`);
    if (column.cellType === "choice") {
      const options = Array.isArray(column.options) ? column.options.filter((o) => typeof o === "string" && o.trim()) : [];
      if (options.length === 0) unfinished(`has a choice column ("${String(column.label ?? column.id)}") with no choices.`);
    }
  }
  if (table.rowMode !== "fixed" && table.rowMode !== "dynamic") invalid("does not say whether the table rows are fixed or added by the cleaner.");
  if (table.rowMode === "fixed") {
    const labels = Array.isArray(table.rowLabels) ? table.rowLabels.filter((label) => typeof label === "string" && label.trim()) : [];
    if (labels.length === 0) unfinished("is a fixed-row table with no rows.");
    if (labels.length > TABLE_MAX_ROWS) invalid(`has more than ${TABLE_MAX_ROWS} table rows.`);
  } else if (table.rowMode === "dynamic") {
    const min = table.minRows;
    const max = table.maxRows;
    const intIn = (value: unknown) => value === undefined || (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= TABLE_MAX_ROWS);
    if (!intIn(min) || !intIn(max)) invalid(`has table row limits outside 0–${TABLE_MAX_ROWS}.`);
    else if (typeof min === "number" && typeof max === "number" && min > max) invalid("has a minimum number of rows above its maximum.");
    else if (max === 0) invalid("lets the cleaner add no rows at all.");
  }
  return findings;
}

function effectIssues(field: Node): string[] {
  if (field.effects === undefined) return [];
  if (!Array.isArray(field.effects)) return ["has effects that are not a list."];
  const issues: string[] = [];
  const kinds = new Set<string>();
  for (const effect of field.effects) {
    if (!isNode(effect)) {
      issues.push("has an effect that is not an object.");
      continue;
    }
    if (typeof effect.kind === "string" && kinds.has(effect.kind)) issues.push(`has the same effect twice (${effect.kind}).`);
    if (typeof effect.kind === "string") kinds.add(effect.kind);
    if (effect.kind === "urgent-stock-below") {
      if (field.type !== "stock_count") issues.push("raises urgent stock, which only a Stock count question can do.");
      const threshold = effect.threshold;
      if (!(typeof threshold === "number" && Number.isInteger(threshold) && threshold >= 1 && threshold <= STOCK_COUNT_MAX)) {
        issues.push("raises urgent stock below a threshold that is not a whole number of at least 1.");
      }
    } else if (effect.kind === "damage-report") {
      if (field.type !== "yesno") issues.push("opens a damage report, which only a Yes / No question can do.");
      if (effect.when !== "yes" && effect.when !== "no") issues.push("opens a damage report without saying on which answer.");
      for (const key of ["area", "category"] as const) {
        if (effect[key] !== undefined && (typeof effect[key] !== "string" || String(effect[key]).length > 120)) issues.push(`has a damage ${key} that is not short text.`);
      }
    } else {
      issues.push(`has an unknown effect (${String(effect.kind)}).`);
    }
  }
  return issues;
}

/** Findings for one question; each message continues the question's name. */
export function structuredFieldFindings(field: Node): StructuredFieldFinding[] {
  const findings: StructuredFieldFinding[] = [];
  if (field.type === "table") findings.push(...tableFindings(field.table));
  if (field.type === "stock_count" && (typeof field.stockItemId !== "string" || !field.stockItemId.trim())) {
    findings.push({ message: STOCK_ITEM_MISSING, incomplete: true });
  }
  for (const message of effectIssues(field)) findings.push({ message, incomplete: false });
  return findings;
}

/** Issues for one question (complete or not); each message continues the question's name. */
export function structuredFieldIssues(field: Node): string[] {
  return structuredFieldFindings(field).map((finding) => finding.message);
}

/** Stock items counted by more than one question in the form (by item id). */
export function duplicateStockCountItems(schema: unknown): Array<{ itemId: string; labels: string[] }> {
  if (!isNode(schema) || !Array.isArray(schema.sections)) return [];
  const byItem = new Map<string, string[]>();
  const visit = (field: unknown) => {
    if (!isNode(field)) return;
    if (field.type === "stock_count" && typeof field.stockItemId === "string" && field.stockItemId) {
      const labels = byItem.get(field.stockItemId) ?? [];
      labels.push(typeof field.label === "string" && field.label.trim() ? field.label.trim() : String(field.id ?? "question"));
      byItem.set(field.stockItemId, labels);
    }
    if (Array.isArray(field.children)) field.children.forEach(visit);
  };
  for (const section of schema.sections) {
    if (isNode(section) && Array.isArray(section.fields)) section.fields.forEach(visit);
  }
  return Array.from(byItem.entries())
    .filter(([, labels]) => labels.length > 1)
    .map(([itemId, labels]) => ({ itemId, labels }));
}
