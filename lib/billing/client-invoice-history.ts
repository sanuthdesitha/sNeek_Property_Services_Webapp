/**
 * The editor's History card: AuditLog rows written for this invoice, plus the
 * timestamps stored on the invoice itself. Line edits, approval, sending and
 * Xero pushes write no audit row today, so only their stored timestamps (when
 * there is one) can appear; the screen says so.
 */
import { db } from "@/lib/db";
import type { HistoryEntry } from "./client-invoice-editor-types";

const HISTORY_LIMIT = 50;

type AuditRow = {
  id: string;
  action: string;
  after: unknown;
  createdAt: Date;
  user: { name: string | null; email: string | null } | null;
};

function field(after: unknown, key: string): string | null {
  if (!after || typeof after !== "object" || Array.isArray(after)) return null;
  const value = (after as Record<string, unknown>)[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function aud(value: string | null): string {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount)
    : "an amount";
}

/** Plain words for each audit action this invoice can carry. */
export function describeInvoiceAudit(action: string, after: unknown): string {
  switch (action) {
    case "CLIENT_INVOICE_PAYMENT_RECORD": {
      const method = field(after, "method");
      return `Payment of ${aud(field(after, "amount"))} recorded${method ? ` (${method.replace(/_/g, " ").toLowerCase()})` : ""}`;
    }
    case "CLIENT_INVOICE_REVERSED": {
      const reason = field(after, "reason");
      return `Reversed to draft from ${field(after, "from") ?? "an issued state"}${reason ? `: ${reason}` : ""}`;
    }
    case "invoice.status_override":
      return `Status overridden from ${field(after, "from") ?? "?"} to ${field(after, "to") ?? "?"}`;
    case "CLIENT_INVOICE_XERO_RECONCILED_VOID":
      return "Voided after the correction was reconciled in Xero";
    case "STARTED_WORK_REVIEW_CONFIRMED":
      return "Started-work office review confirmed";
    case "STARTED_WORK_DRAFT_REFRESHED":
      return "Started-work draft refreshed from jobs";
    case "CLIENT_INVOICE_BULK_ACTION":
      return `Bulk action: ${field(after, "action") ?? "unknown"}`;
    default:
      return action;
  }
}

function auditEntry(row: AuditRow): HistoryEntry {
  return {
    id: `audit:${row.id}`,
    at: row.createdAt.toISOString(),
    label: describeInvoiceAudit(row.action, row.after),
    actor: row.user?.name || row.user?.email || null,
    source: "audit",
  };
}

export type HistoryInvoice = {
  id: string;
  createdAt: Date;
  sentAt: Date | null;
  xeroExportedAt: Date | null;
  paidAt: Date | null;
};

function recordEntries(invoice: HistoryInvoice): HistoryEntry[] {
  const entries: Array<[Date | null, string, string]> = [
    [invoice.createdAt, "created", "Invoice created"],
    // Re-sending restamps sentAt, so this is the latest send only.
    [invoice.sentAt, "sent", "Last sent to the client"],
    [invoice.xeroExportedAt, "xero", "Pushed to Xero"],
    [invoice.paidAt, "paid", "Recorded as fully paid"],
  ];
  return entries.flatMap(([at, key, label]) =>
    at ? [{ id: `record:${key}`, at: at.toISOString(), label, actor: null, source: "record" as const }] : [],
  );
}

export async function clientInvoiceHistory(invoice: HistoryInvoice, client: Pick<typeof db, "auditLog"> = db): Promise<HistoryEntry[]> {
  const rows = await client.auditLog.findMany({
    where: { entity: "ClientInvoice", entityId: invoice.id },
    select: { id: true, action: true, after: true, createdAt: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  return [...rows.map(auditEntry), ...recordEntries(invoice)].sort((a, b) => b.at.localeCompare(a.at));
}
