/**
 * A pay request's history, read from its audit log (pure; 2026-11-18).
 *
 * Two audiences:
 *   - "internal" (office): every change, including the private note, the
 *     client billing choice and client amount;
 *   - "self" (the cleaner): what happened to THEIR money and why — never the
 *     private note, never the client amount or whether the client is billed.
 *
 * Each entry is built from an explicit allowlist of fields per audience, so a
 * field added to the audit record later does not reach the cleaner by default.
 */

export type PayRequestHistoryAudience = "internal" | "self";

export interface PayRequestAuditRow {
  action: string;
  createdAt: Date | string;
  before: unknown;
  after: unknown;
  actorName?: string | null;
}

export interface PayRequestHistoryEntry {
  at: string;
  /** Short, plain sentence: "Approved at $80.00", "Amount changed $80.00 → $60.00". */
  summary: string;
  /** Extra lines (reasons, notes, what changed). */
  details: string[];
  /** Office only. */
  actorName: string | null;
}

type Fields = Record<string, unknown>;

function fields(value: unknown): Fields {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Fields) : {};
}

function money(value: unknown): string | null {
  const n = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(n)) return null;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function changed(before: Fields, after: Fields, key: string): boolean {
  return key in after && JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null);
}

function statusWord(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  if (raw === "APPROVED") return "Approved";
  if (raw === "REJECTED") return "Declined";
  if (raw === "PENDING") return "Reopened";
  return raw ? raw.charAt(0) + raw.slice(1).toLowerCase() : "Changed";
}

/** The cleaner-safe and office lines describing what an edit changed. */
function editLines(before: Fields, after: Fields, audience: PayRequestHistoryAudience): string[] {
  const lines: string[] = [];
  if (changed(before, after, "approvedAmount")) {
    lines.push(`Approved amount ${money(before.approvedAmount) ?? "none"} → ${money(after.approvedAmount) ?? "none"}`);
  }
  if (changed(before, after, "requestedAmount")) {
    lines.push(`Requested amount ${money(before.requestedAmount) ?? "none"} → ${money(after.requestedAmount) ?? "none"}`);
  }
  if (changed(before, after, "requestedHours") || changed(before, after, "requestedRate")) {
    lines.push(`Time ${before.requestedHours ?? "—"} h at ${money(before.requestedRate) ?? "—"} → ${after.requestedHours ?? "—"} h at ${money(after.requestedRate) ?? "—"}`);
  }
  if (changed(before, after, "type")) lines.push(`Type ${String(before.type ?? "—").toLowerCase()} → ${String(after.type ?? "—").toLowerCase()}`);
  if (changed(before, after, "title")) lines.push(`Title "${text(before.title) ?? "—"}" → "${text(after.title) ?? "—"}"`);
  if (changed(before, after, "category")) {
    lines.push(`Kind ${String(before.category ?? "SERVICE").toLowerCase()} → ${String(after.category ?? "SERVICE").toLowerCase()}`);
  }
  if (changed(before, after, "decisionMessage") && text(after.decisionMessage)) lines.push(`Message: ${text(after.decisionMessage)}`);
  if (audience === "internal") {
    if (changed(before, after, "adminNote") && text(after.adminNote)) lines.push(`Private note: ${text(after.adminNote)}`);
    if (changed(before, after, "billToClient")) lines.push(after.billToClient ? "Billed to the client" : "Not billed to the client");
    if (changed(before, after, "clientAmount")) {
      lines.push(`Client amount ${money(before.clientAmount) ?? "none"} → ${money(after.clientAmount) ?? "none"}`);
    }
    if (changed(before, after, "clientDescription")) lines.push(`Client wording: ${text(after.clientDescription) ?? "(title)"}`);
  }
  return lines;
}

function entry(row: PayRequestAuditRow, audience: PayRequestHistoryAudience, summary: string, details: string[]): PayRequestHistoryEntry {
  return {
    at: new Date(row.createdAt).toISOString(),
    summary,
    details,
    actorName: audience === "internal" ? row.actorName?.trim() || null : null,
  };
}

/** One audit row → one history entry, or null when this audience does not see it. */
export function historyEntry(row: PayRequestAuditRow, audience: PayRequestHistoryAudience): PayRequestHistoryEntry | null {
  const before = fields(row.before);
  const after = fields(row.after);
  const reason = text(after.changeReason);
  const reasonLine = reason ? [`Reason: ${reason}`] : [];

  switch (row.action) {
    case "CLEANER_PAY_REQUEST_CREATED":
      return entry(row, audience, `Requested ${money(after.amount) ?? ""}`.trim(), []);
    case "PAY_ADJUSTMENT_ADMIN_CREATED":
      return entry(row, audience, `Added by the office${after.approved ? " and approved" : ""} at ${money(after.amount) ?? "an unknown amount"}`, []);
    case "REVIEW_PAY_ADJUSTMENT": {
      const word = statusWord(after.status);
      const amount = after.status === "APPROVED" ? money(after.approvedAmount) : null;
      return entry(row, audience, amount ? `${word} at ${amount}` : word, [...reasonLine, ...editLines(before, after, audience).filter((line) => !line.startsWith("Approved amount"))]);
    }
    case "REVERSE_PAY_ADJUSTMENT":
      return entry(row, audience, "Reopened for review", reasonLine);
    case "EDIT_PAY_ADJUSTMENT_AMOUNT":
      return entry(row, audience, `Amount changed ${money(before.approvedAmount) ?? "none"} → ${money(after.approvedAmount) ?? "none"}`, [
        ...reasonLine,
        ...editLines(before, after, audience).filter((line) => !line.startsWith("Approved amount")),
      ]);
    case "EDIT_PAY_ADJUSTMENT": {
      const lines = editLines(before, after, audience);
      if (lines.length === 0 && !reason) return null;
      return entry(row, audience, "Details edited", [...reasonLine, ...lines]);
    }
    case "PAY_ADJUSTMENT_JOB_LINKED":
      return entry(row, audience, "Linked to a job", editLines(before, after, audience));
    case "PAY_ADJUSTMENT_JOB_UNLINKED":
      return entry(row, audience, "Unlinked from its job", editLines(before, after, audience));
    case "PAY_ADJUSTMENT_CLIENT_BILLING_CHANGED":
      if (audience === "self") return null;
      return entry(row, audience, "Client billing changed", editLines(before, after, audience));
    case "PAY_ADJUSTMENT_MARKED_PAID": {
      const parts = [text(after.paidOutsideDate) ? `on ${text(after.paidOutsideDate)}` : null, text(after.paidOutsideMethod) ? `by ${String(after.paidOutsideMethod).toLowerCase().replace(/_/g, " ")}` : null]
        .filter(Boolean)
        .join(" ");
      const details = [text(after.paidOutsideReference) ? `Reference: ${text(after.paidOutsideReference)}` : null, text(after.paidOutsideNote) ? `Note: ${text(after.paidOutsideNote)}` : null].filter(
        (line): line is string => Boolean(line),
      );
      return entry(row, audience, `Marked paid outside the system${parts ? ` ${parts}` : ""}`, details);
    }
    case "PAY_ADJUSTMENT_PAID_UNDONE":
      return entry(row, audience, "Payment record undone", reasonLine);
    case "PAY_ADJUSTMENT_SENT_TO_CLIENT":
      return audience === "internal"
        ? entry(row, audience, `Sent to the client for approval at ${money(after.amount) ?? "an unknown amount"}`, [])
        : entry(row, audience, "Shared with the client for approval", []);
    case "PAY_ADJUSTMENT_CLIENT_APPROVAL_REVERSED":
      return audience === "internal" ? entry(row, audience, "Client approval request withdrawn", []) : null;
    case "PAY_ADJUSTMENT_PAID_ABOVE_REQUEST":
      return audience === "internal" ? entry(row, audience, `Paid above the request (${money(after.paidAmount) ?? "?"})`, reason ? [] : [text(after.reason) ?? ""].filter(Boolean)) : null;
    default:
      return null;
  }
}

/** The whole history, oldest first. */
export function payRequestHistory(rows: readonly PayRequestAuditRow[], audience: PayRequestHistoryAudience): PayRequestHistoryEntry[] {
  return [...rows]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((row) => historyEntry(row, audience))
    .filter((item): item is PayRequestHistoryEntry => item !== null);
}

/** Audit actions the history reads (for the loader's query). */
export const PAY_REQUEST_HISTORY_ACTIONS = [
  "CLEANER_PAY_REQUEST_CREATED",
  "PAY_ADJUSTMENT_ADMIN_CREATED",
  "REVIEW_PAY_ADJUSTMENT",
  "REVERSE_PAY_ADJUSTMENT",
  "EDIT_PAY_ADJUSTMENT_AMOUNT",
  "EDIT_PAY_ADJUSTMENT",
  "PAY_ADJUSTMENT_JOB_LINKED",
  "PAY_ADJUSTMENT_JOB_UNLINKED",
  "PAY_ADJUSTMENT_CLIENT_BILLING_CHANGED",
  "PAY_ADJUSTMENT_MARKED_PAID",
  "PAY_ADJUSTMENT_PAID_UNDONE",
  "PAY_ADJUSTMENT_SENT_TO_CLIENT",
  "PAY_ADJUSTMENT_CLIENT_APPROVAL_REVERSED",
  "PAY_ADJUSTMENT_PAID_ABOVE_REQUEST",
] as const;
