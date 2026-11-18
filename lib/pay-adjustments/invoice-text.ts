/**
 * How an approved pay request READS on an invoice line (pure; 2026-11-18).
 *
 * Owner request: an extra linked to a job is not a separate mystery line — it
 * sits on the job's own line, the line's total is the combined figure, and the
 * description lists the base and then each extra with its details.
 *
 * Two audiences, two texts, never mixed:
 *   - the CLEANER's invoice (their own pay): base pay, then each extra with its
 *     hours × rate (or "fixed amount") and their own note, trimmed;
 *   - the CLIENT's invoice: base service, then each extra's title (or the
 *     office's client wording) and the CLIENT amount. The cleaner's rate and
 *     note never reach the client — only hours, which describe the work.
 *
 * Amounts are the stored figures, rounded to whole cents; the combined total is
 * the cents-exact sum of its parts. Nothing here reads a database.
 */

/** Whole cents, the same rounding every money module uses. */
export function toCents(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100);
}

export function fromCents(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

/** "$80.00", "-$12.50" — plain text for documents and Xero descriptions. */
export function invoiceMoney(amount: number): string {
  const cents = toCents(amount);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-AU");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** Collapse whitespace and cut a note to a readable length. */
export function trimNote(note: string | null | undefined, max = 140): string | null {
  const flat = (note ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function hoursText(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded} h`;
}

export interface ExtraSource {
  id: string;
  title?: string | null;
  type?: string | null;
  requestedHours?: number | null;
  requestedRate?: number | null;
  cleanerNote?: string | null;
}

function extraLabel(extra: ExtraSource): string {
  return extra.title?.trim() || trimNote(extra.cleanerNote, 60) || "Extra payment";
}

/** One extra as the cleaner's invoice prints it under the job. */
export interface CleanerExtraDetail {
  id: string;
  label: string;
  /** Hours and rate of an HOURLY request; null for a fixed amount. */
  hours: number | null;
  rate: number | null;
  amount: number;
  note: string | null;
}

export function cleanerExtraDetail(extra: ExtraSource, signedAmount: number): CleanerExtraDetail {
  const label = extraLabel(extra);
  const note = trimNote(extra.cleanerNote);
  const hours = Number(extra.requestedHours);
  const rate = Number(extra.requestedRate);
  const hourly = extra.type === "HOURLY" && Number.isFinite(hours) && hours > 0 && Number.isFinite(rate) && rate > 0;
  return {
    id: extra.id,
    label,
    hours: hourly ? hours : null,
    rate: hourly ? rate : null,
    amount: fromCents(toCents(signedAmount)),
    // The note is dropped when it IS the label (an untitled request).
    note: note && note !== label ? note : null,
  };
}

/**
 * How the extra was worked out: "2 h × $40.00", or "$40.00/h" when the
 * document hides hours (the invoice's showHours switch hides every hour), or
 * "fixed amount".
 */
export function cleanerExtraBasis(detail: Pick<CleanerExtraDetail, "hours" | "rate">, showHours = true): string {
  if (detail.hours == null || detail.rate == null) return "fixed amount";
  return showHours ? `${hoursText(detail.hours)} × ${invoiceMoney(detail.rate)}` : `${invoiceMoney(detail.rate)}/h`;
}

/** "Extra: Oven deep clean — 2 h × $40.00 — $80.00 — "baked-on grease"" */
export function cleanerExtraText(detail: CleanerExtraDetail, showHours = true): string {
  const head = detail.amount < 0 ? "Deduction" : "Extra";
  const note = detail.note ? ` — "${detail.note}"` : "";
  return `${head}: ${detail.label} — ${cleanerExtraBasis(detail, showHours)} — ${invoiceMoney(detail.amount)}${note}`;
}

/**
 * The cleaner invoice job line as text (Xero bill line, plain summaries). With
 * no extras it is exactly the description the send route always wrote.
 */
export function cleanerJobLineText(input: {
  date: string;
  property: string;
  jobName: string;
  baseAmount: number;
  extras: readonly CleanerExtraDetail[];
}): string {
  const head = `${input.date} · ${input.property} · ${input.jobName}`;
  if (input.extras.length === 0) return head;
  return [head, `Base pay ${invoiceMoney(input.baseAmount)}`, ...input.extras.map((detail) => cleanerExtraText(detail))].join("\n");
}

/** "Parking — for Bondi Apartment, 12/11/2026 (job J-1042)" */
export function relatedJobText(job: { propertyName?: string | null; date?: string | null; jobNumber?: string | null } | null): string | null {
  if (!job) return null;
  const parts = [job.propertyName?.trim(), job.date?.trim()].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return job.jobNumber ? `for job ${job.jobNumber}` : null;
  const number = job.jobNumber ? ` (job ${job.jobNumber})` : "";
  return `for ${parts.join(", ")}${number}`;
}

/* ── Client invoice ───────────────────────────────────────────────────── */

export interface ClientExtraSource {
  title?: string | null;
  clientDescription?: string | null;
  type?: string | null;
  requestedHours?: number | null;
}

/**
 * One extra as the CLIENT reads it. Only the office's client wording (or the
 * title), the hours of work when it was hourly, and the client amount — never
 * the cleaner's rate, pay or note.
 */
export function clientExtraText(extra: ClientExtraSource, clientAmount: number): string {
  const label = extra.clientDescription?.trim() || extra.title?.trim() || "Additional work";
  const hours = Number(extra.requestedHours);
  const hoursPart = extra.type === "HOURLY" && Number.isFinite(hours) && hours > 0 ? ` (${hoursText(hours)})` : "";
  return `Extra: ${trimNote(label, 120)}${hoursPart} ${invoiceMoney(clientAmount)}`;
}

/** Marks where the extras block of a folded description begins. */
export const BASE_SERVICE_PREFIX = "Base service ";

/** The description a folded line started from (the text before the block). */
export function baseClientDescription(description: string): string {
  const marker = `\n${BASE_SERVICE_PREFIX}`;
  const at = description.indexOf(marker);
  return at >= 0 ? description.slice(0, at) : description;
}

export interface FoldableLine {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ClientFoldPart {
  amount: number;
  text: string;
}

/**
 * Fold extras into a job line: ONE line, total = base + every extra (cents
 * exact), description = the base text, "Base service $X", then each extra.
 * `baseAmount` is the line's own charge without any extra.
 *
 * Returns null when the line cannot carry a fold honestly — a quantity other
 * than one would multiply the extra. The caller then bills the extra as its
 * own line.
 */
export function composeFoldedClientLine(input: {
  baseDescription: string;
  baseAmount: number;
  quantity: number;
  extras: readonly ClientFoldPart[];
}): { description: string; unitPrice: number; lineTotal: number } | null {
  if (input.quantity !== 1) return null;
  const baseCents = toCents(input.baseAmount);
  const totalCents = input.extras.reduce((sum, part) => sum + toCents(part.amount), baseCents);
  const total = fromCents(totalCents);
  if (input.extras.length === 0) {
    return { description: input.baseDescription, unitPrice: fromCents(baseCents), lineTotal: fromCents(baseCents) };
  }
  const description = [
    input.baseDescription,
    `${BASE_SERVICE_PREFIX}${invoiceMoney(fromCents(baseCents))}`,
    ...input.extras.map((part) => part.text),
  ].join("\n");
  return { description, unitPrice: total, lineTotal: total };
}

/**
 * Re-compose a line that already carries extras after one is added or taken
 * off. The base is the line's current total less the extras it currently
 * holds (as stored when each was billed), so a fold always undoes exactly.
 */
export function recomposeFoldedClientLine(input: {
  line: FoldableLine;
  currentExtras: readonly ClientFoldPart[];
  nextExtras: readonly ClientFoldPart[];
}): { description: string; unitPrice: number; lineTotal: number } | null {
  const heldCents = input.currentExtras.reduce((sum, part) => sum + toCents(part.amount), 0);
  const baseCents = toCents(input.line.unitPrice) - heldCents;
  if (baseCents < 0) return null;
  return composeFoldedClientLine({
    baseDescription: baseClientDescription(input.line.description),
    baseAmount: fromCents(baseCents),
    quantity: input.line.quantity,
    extras: input.nextExtras,
  });
}
