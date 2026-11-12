/**
 * Answers of the structured question types: "table" and "stock_count".
 *
 *  table        an array of row objects keyed by column id
 *               ([{ c1: "Fridge", c2: 3, c3: true }]); fixed rows answer
 *               row i of `table.rowLabels`, "cleaner can add rows" allows
 *               `minRows`…`maxRows` rows (never more than TABLE_MAX_ROWS).
 *  stock_count  { itemId, count }: the question's own item and a
 *               non-negative whole number.
 *
 * These rules are enforced by the cleaner submit route from the first
 * release (rule "table" / "stock-count", not an extended warning): no form
 * could use these types before they existed, so no in-flight draft can be
 * rejected by a rule it could not have known. The phone runs the same
 * functions through collectFormErrors.
 *
 * PURE: no database, no React. Imported by the server and the cleaner app.
 */
import type { StockCountAnswer, TableCellType, TableColumn, TableConfig } from "./types";

export const TABLE_MAX_COLUMNS = 8;
export const TABLE_MAX_ROWS = 50;
export const TABLE_TEXT_MAX = 500;
export const STOCK_COUNT_MAX = 100_000;
export const TABLE_CELL_TYPES: readonly TableCellType[] = ["text", "number", "yesno", "choice"];

export type StructuredFieldLike = {
  type?: unknown;
  required?: unknown;
  table?: unknown;
  stockItemId?: unknown;
};

export type TableRow = Record<string, unknown>;

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** A table config read tolerantly from a stored question (bad parts dropped). */
export function readTableConfig(raw: unknown): TableConfig {
  const node = isNode(raw) ? raw : {};
  const columns: TableColumn[] = (Array.isArray(node.columns) ? node.columns : [])
    .filter(isNode)
    .filter((column) => typeof column.id === "string" && column.id.trim())
    .map((column) => ({
      id: String(column.id),
      label: typeof column.label === "string" ? column.label : String(column.id),
      cellType: TABLE_CELL_TYPES.includes(column.cellType as TableCellType) ? (column.cellType as TableCellType) : "text",
      ...(column.required === true ? { required: true } : {}),
      ...(Array.isArray(column.options) ? { options: column.options.filter((o): o is string => typeof o === "string" && o.trim().length > 0) } : {}),
    }));
  const rowMode = node.rowMode === "fixed" ? "fixed" : "dynamic";
  const rowLabels = Array.isArray(node.rowLabels) ? node.rowLabels.map((label) => String(label ?? "")) : [];
  const minRows = Number.isInteger(node.minRows) ? Number(node.minRows) : undefined;
  const maxRows = Number.isInteger(node.maxRows) ? Number(node.maxRows) : undefined;
  return {
    columns,
    rowMode,
    ...(rowMode === "fixed" ? { rowLabels } : {}),
    ...(minRows !== undefined ? { minRows } : {}),
    ...(maxRows !== undefined ? { maxRows } : {}),
  };
}

function cellIsEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function cellError(column: TableColumn, value: unknown): string | null {
  if (cellIsEmpty(value)) return null;
  switch (column.cellType) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `"${column.label}" must be a number.`;
    case "yesno":
      return typeof value === "boolean" ? null : `"${column.label}" must be Yes or No.`;
    case "choice":
      return typeof value === "string" && (column.options ?? []).includes(value) ? null : `"${column.label}" must be one of its choices.`;
    default:
      return typeof value === "string" && value.length <= TABLE_TEXT_MAX ? null : `"${column.label}" must be text of at most ${TABLE_TEXT_MAX} characters.`;
  }
}

function rowHasContent(row: TableRow, columns: TableColumn[]): boolean {
  return columns.some((column) => !cellIsEmpty(row[column.id]));
}

/** Row limits the cleaner works within (fixed rows: exactly the labelled rows). */
export function tableRowLimits(config: TableConfig): { min: number; max: number } {
  if (config.rowMode === "fixed") {
    const count = Math.min(config.rowLabels?.length ?? 0, TABLE_MAX_ROWS);
    return { min: count, max: count };
  }
  const max = Math.min(Math.max(config.maxRows ?? TABLE_MAX_ROWS, 1), TABLE_MAX_ROWS);
  return { min: Math.min(Math.max(config.minRows ?? 0, 0), max), max };
}

/** True when the table answer holds at least one filled cell. */
export function isTableAnswered(value: unknown, rawConfig: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const config = readTableConfig(rawConfig);
  return value.some((row) => isNode(row) && rowHasContent(row, config.columns));
}

/**
 * One error message for a table answer, or null when it is valid.
 * `undefined`/empty answers are valid unless the question is required.
 */
export function tableAnswerError(field: StructuredFieldLike, value: unknown): string | null {
  const config = readTableConfig(field.table);
  const required = field.required === true;
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
    return required ? "Fill in the table." : null;
  }
  if (!Array.isArray(value)) return "The table answer is not a list of rows.";
  if (value.length > TABLE_MAX_ROWS) return `A table can hold at most ${TABLE_MAX_ROWS} rows.`;
  const limits = tableRowLimits(config);
  const columnIds = new Set(config.columns.map((column) => column.id));
  const rows: TableRow[] = [];
  for (const row of value) {
    if (!isNode(row)) return "Each table row must be a set of cells.";
    const unknown = Object.keys(row).find((key) => !columnIds.has(key));
    if (unknown) return `The table has no column "${unknown}".`;
    rows.push(row);
  }
  if (config.rowMode === "fixed" && rows.length !== limits.max) {
    return `This table has ${limits.max} row${limits.max === 1 ? "" : "s"}; ${rows.length} were sent.`;
  }
  const filled = rows.filter((row) => rowHasContent(row, config.columns));
  if (config.rowMode === "dynamic") {
    if (rows.length > limits.max) return `Add at most ${limits.max} row${limits.max === 1 ? "" : "s"}.`;
    const needed = required ? Math.max(1, limits.min) : filled.length > 0 ? limits.min : 0;
    if (filled.length < needed) return `Fill in at least ${needed} row${needed === 1 ? "" : "s"}.`;
  } else if (required && filled.length === 0) {
    return "Fill in the table.";
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const mustBeComplete = config.rowMode === "fixed" ? required || rowHasContent(row, config.columns) : rowHasContent(row, config.columns);
    for (const column of config.columns) {
      const problem = cellError(column, row[column.id]);
      if (problem) return `Row ${index + 1}: ${problem}`;
      if (mustBeComplete && column.required && cellIsEmpty(row[column.id])) {
        return `Row ${index + 1}: "${column.label}" is required.`;
      }
    }
  }
  return null;
}

/** The stock count answer, or null when it is not a valid one for this question. */
export function readStockCountAnswer(value: unknown): StockCountAnswer | null {
  if (!isNode(value)) return null;
  const count = value.count;
  if (typeof value.itemId !== "string" || !value.itemId) return null;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > STOCK_COUNT_MAX) return null;
  return { itemId: value.itemId, count };
}

export function stockCountAnswerError(field: StructuredFieldLike, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return field.required === true ? "Enter the count." : null;
  if (!isNode(value)) return "The count is not a stock count answer.";
  if (value.count === undefined || value.count === null || value.count === "") {
    return field.required === true ? "Enter the count." : null;
  }
  const answer = readStockCountAnswer(value);
  if (!answer) return `Enter a whole number from 0 to ${STOCK_COUNT_MAX}.`;
  if (typeof field.stockItemId !== "string" || answer.itemId !== field.stockItemId) return "The count is for a different item than this question.";
  return null;
}

/** True when a stock count holds a valid number. */
export function isStockCountAnswered(value: unknown): boolean {
  return readStockCountAnswer(value) !== null;
}

/** Error for any structured type, or null (other types are not this module's business). */
export function structuredAnswerError(field: StructuredFieldLike, value: unknown): { message: string; rule: "table" | "stock-count" } | null {
  if (field.type === "table") {
    const message = tableAnswerError(field, value);
    return message ? { message, rule: "table" } : null;
  }
  if (field.type === "stock_count") {
    const message = stockCountAnswerError(field, value);
    return message ? { message, rule: "stock-count" } : null;
  }
  return null;
}

function formatCell(column: TableColumn, value: unknown): string {
  if (cellIsEmpty(value)) return "–";
  if (column.cellType === "yesno") return value === true ? "Yes" : value === false ? "No" : String(value);
  return String(value);
}

/** Header and body of a table answer for reports (columns in builder order). */
export function tableAnswerGrid(field: { table?: unknown }, value: unknown): { columns: string[]; rows: string[][] } | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const config = readTableConfig(field.table);
  const labelled = config.rowMode === "fixed";
  const columns = [...(labelled ? ["Row"] : []), ...config.columns.map((column) => column.label)];
  const rows = value.filter(isNode).map((row, index) => [
    ...(labelled ? [config.rowLabels?.[index] || `Row ${index + 1}`] : []),
    ...config.columns.map((column) => formatCell(column, row[column.id])),
  ]);
  return rows.length > 0 ? { columns, rows } : null;
}

/** Plain text of a table answer: one line per row ("Fridge — Count: 3 · Clean: Yes"). */
export function formatTableAnswer(field: { table?: unknown }, value: unknown): string {
  const config = readTableConfig(field.table);
  if (!isTableAnswered(value, field.table)) return "-";
  return (value as unknown[])
    .filter(isNode)
    .map((row, index) => {
      const name = config.rowMode === "fixed" ? config.rowLabels?.[index] || `Row ${index + 1}` : `Row ${index + 1}`;
      const cells = config.columns.map((column) => `${column.label}: ${formatCell(column, row[column.id])}`).join(" · ");
      return `${name} — ${cells}`;
    })
    .join("\n");
}

export function formatStockCountAnswer(field: { unit?: unknown; stockItemName?: unknown }, value: unknown): string {
  const answer = readStockCountAnswer(value);
  if (!answer) return "-";
  const unit = typeof field.unit === "string" && field.unit.trim() ? ` ${field.unit.trim()}` : "";
  const item = typeof field.stockItemName === "string" && field.stockItemName.trim() ? ` (${field.stockItemName.trim()})` : "";
  return `${answer.count}${unit}${item}`;
}

/** One line for the office's submission views: "Toilet paper · counted 6 rolls". */
export function stockCountSummary(field: { unit?: unknown; stockItemName?: unknown }, value: unknown): string {
  const answer = readStockCountAnswer(value);
  if (!answer) return "-";
  const item = typeof field.stockItemName === "string" && field.stockItemName.trim() ? field.stockItemName.trim() : "Stock item";
  const unit = typeof field.unit === "string" && field.unit.trim() ? ` ${field.unit.trim()}` : "";
  return `${item} · counted ${answer.count}${unit}`;
}
