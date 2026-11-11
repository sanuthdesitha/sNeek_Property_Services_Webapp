/**
 * Jobs CSV import: the file format and row validation. PURE (no database):
 * `csv-import-server.ts` supplies the property and cleaner lookups.
 *
 * Columns (header row required, any order, case-insensitive):
 *   property   exact property name or property id (required)
 *   date       YYYY-MM-DD (required)
 *   start      HH:mm (optional)
 *   due        HH:mm, after start (optional)
 *   job_type   a job type, e.g. AIRBNB_TURNOVER or "Airbnb turnover" (required)
 *   cleaner    exact cleaner email or exact name (optional)
 *   notes      free text for the cleaner (optional)
 *
 * Nothing is guessed: an unknown property, an ambiguous name, a bad date or a
 * time out of order refuses that row with the reason.
 */
export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_BYTES = 200_000;

export const IMPORT_COLUMNS = ["property", "date", "start", "due", "job_type", "cleaner", "notes"] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
const REQUIRED: readonly ImportColumn[] = ["property", "date", "job_type"];

export const IMPORT_TEMPLATE = [
  IMPORT_COLUMNS.join(","),
  "The Bondi Studio,2026-11-12,10:00,14:00,AIRBNB_TURNOVER,jane@example.com,Guest arrives 15:00",
  "Coogee Terrace,2026-11-13,09:00,12:00,DEEP_CLEAN,,",
].join("\n");

/** Parse CSV text (RFC 4180 quoting, CRLF or LF). Returns rows of raw cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === "\"" && source[index + 1] === "\"") { cell += "\""; index += 1; }
      else if (char === "\"") quoted = false;
      else cell += char;
      continue;
    }
    if (char === "\"" && cell === "") quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

export type ImportHeaderResult = { kind: "ok"; index: Record<ImportColumn, number> } | { kind: "error"; message: string };

export function readImportHeader(header: string[]): ImportHeaderResult {
  const normalized = header.map((value) => value.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const index = {} as Record<ImportColumn, number>;
  for (const column of IMPORT_COLUMNS) index[column] = normalized.indexOf(column);
  const missing = REQUIRED.filter((column) => index[column] === -1);
  if (missing.length > 0) return { kind: "error", message: `The header row is missing: ${missing.join(", ")}. Download the template for the expected columns.` };
  return { kind: "ok", index };
}

export type PropertyRef = { id: string; name: string; isActive: boolean };
export type CleanerRef = { id: string; name: string | null; email: string | null };

export type ImportLookups = {
  properties: readonly PropertyRef[];
  cleaners: readonly CleanerRef[];
  jobTypes: readonly string[];
};

export type ImportRowValues = {
  propertyId: string;
  propertyName: string;
  date: string;
  startTime: string | null;
  dueTime: string | null;
  jobType: string;
  cleanerId: string | null;
  cleanerName: string | null;
  notes: string | null;
};

export type ImportRow = {
  /** 1-based line in the file (the header is line 1). */
  line: number;
  ok: boolean;
  errors: string[];
  values: ImportRowValues | null;
  /** Cells as written, for the preview. */
  raw: Record<ImportColumn, string>;
};

function realDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function readTime(value: string, label: string, errors: string[]): string | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    errors.push(`${label} "${value}" is not a time written as HH:mm.`);
    return null;
  }
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function matchProperty(value: string, properties: readonly PropertyRef[], errors: string[]): PropertyRef | null {
  if (!value) { errors.push("Property is required."); return null; }
  const byId = properties.find((property) => property.id === value);
  const byName = properties.filter((property) => property.name.trim().toLowerCase() === value.toLowerCase());
  const match = byId ?? (byName.length === 1 ? byName[0] : null);
  if (!match) {
    errors.push(byName.length > 1 ? `More than one property is named "${value}". Use the property id.` : `No property is named "${value}" (exact name or id).`);
    return null;
  }
  if (!match.isActive) { errors.push(`${match.name} is inactive.`); return null; }
  return match;
}

function matchCleaner(value: string, cleaners: readonly CleanerRef[], errors: string[]): CleanerRef | null {
  if (!value) return null;
  const needle = value.toLowerCase();
  const byEmail = cleaners.find((cleaner) => cleaner.email?.trim().toLowerCase() === needle);
  const byName = cleaners.filter((cleaner) => cleaner.name?.trim().toLowerCase() === needle);
  const match = byEmail ?? (byName.length === 1 ? byName[0] : null);
  if (!match) errors.push(byName.length > 1 ? `More than one cleaner is named "${value}". Use their email.` : `No active cleaner matches "${value}" (exact email or name).`);
  return match;
}

function matchJobType(value: string, jobTypes: readonly string[], errors: string[]): string | null {
  const key = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!key) { errors.push("Job type is required."); return null; }
  if (!jobTypes.includes(key)) { errors.push(`Unknown job type "${value}".`); return null; }
  return key;
}

export function validateImportRow(cells: string[], index: Record<ImportColumn, number>, line: number, lookups: ImportLookups): ImportRow {
  const raw = {} as Record<ImportColumn, string>;
  for (const column of IMPORT_COLUMNS) raw[column] = index[column] >= 0 ? (cells[index[column]] ?? "").trim() : "";
  const errors: string[] = [];
  const property = matchProperty(raw.property, lookups.properties, errors);
  if (!realDay(raw.date)) errors.push(raw.date ? `Date "${raw.date}" is not a real date written as YYYY-MM-DD.` : "Date is required.");
  const startTime = readTime(raw.start, "Start", errors);
  const dueTime = readTime(raw.due, "Due", errors);
  if (startTime && dueTime && dueTime < startTime) errors.push("Due time is before the start time.");
  const jobType = matchJobType(raw.job_type, lookups.jobTypes, errors);
  const cleaner = matchCleaner(raw.cleaner, lookups.cleaners, errors);
  if (raw.notes.length > 2000) errors.push("Notes are longer than 2,000 characters.");
  const ok = errors.length === 0 && property !== null && jobType !== null;
  return {
    line, ok, errors, raw,
    values: ok ? {
      propertyId: property!.id, propertyName: property!.name, date: raw.date, startTime, dueTime, jobType: jobType!,
      cleanerId: cleaner?.id ?? null, cleanerName: cleaner ? cleaner.name?.trim() || cleaner.email || "Cleaner" : null,
      notes: raw.notes || null,
    } : null,
  };
}

export type ImportPreview = { kind: "ok"; rows: ImportRow[] } | { kind: "error"; message: string };

export function previewImport(text: string, lookups: ImportLookups): ImportPreview {
  if (text.length > MAX_IMPORT_BYTES) return { kind: "error", message: `The file is larger than ${MAX_IMPORT_BYTES / 1000} KB. Split it into smaller files.` };
  const [header, ...body] = parseCsv(text);
  if (!header) return { kind: "error", message: "The file is empty." };
  const columns = readImportHeader(header);
  if (columns.kind === "error") return columns;
  if (body.length === 0) return { kind: "error", message: "The file has a header but no job rows." };
  if (body.length > MAX_IMPORT_ROWS) return { kind: "error", message: `The file has ${body.length} rows; import at most ${MAX_IMPORT_ROWS} at a time.` };
  return { kind: "ok", rows: body.map((cells, offset) => validateImportRow(cells, columns.index, offset + 2, lookups)) };
}
