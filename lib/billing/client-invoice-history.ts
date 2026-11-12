/**
 * The editor's History card: AuditLog rows written for this invoice, plus the
 * timestamps stored on the invoice itself. Line edits, approval, sending and
 * Xero pushes write no audit row today, so only their stored timestamps (when
 * there is one) can appear; the screen says so.
 */
import { db } from "@/lib/db";
import type { HistoryEntry } from "./client-invoice-editor-types";
import { auditActorLabel } from "@/lib/audit/system-actor";

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
      if (field(after, "source") === "XERO") {
        const day = field(after, "paidDate");
        return `Payment of ${aud(field(after, "amount"))} recorded from Xero${day ? ` (paid ${day.slice(0, 10)})` : ""}`;
      }
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
    case "CLIENT_INVOICE_BULK_ROW": {
      const reason = field(after, "reason");
      return `Bulk ${field(after, "action") ?? "action"}: ${field(after, "outcome") ?? "unknown"}${reason ? ` (${reason})` : ""}`;
    }
    case "CLIENT_INVOICE_SENT": {
      const outcome = field(after, "outcome");
      if (outcome !== "sent") return `Email send failed${field(after, "error") ? `: ${field(after, "error")}` : ""}`;
      return (after as { resend?: unknown } | null)?.resend === true ? "Sent to the client again by email" : "Sent to the client by email";
    }
    case "CLIENT_INVOICE_PAYMENT_RECEIPT": {
      const outcome = field(after, "outcome");
      const detail = field(after, "error") ?? field(after, "reason");
      if (outcome === "sent") return "Payment receipt emailed to the client";
      if (outcome === "no-recipient") return "Payment receipt not sent: the client has no email address";
      if (outcome === "withheld") return `Payment receipt withheld${detail ? `: ${detail}` : ""}`;
      if (outcome === "skipped") return `Payment receipt not sent${detail ? ` (${detail})` : ""}`;
      return `Payment receipt failed${detail ? `: ${detail}` : ""}`;
    }
    case "CLIENT_INVOICE_XERO_PUSH": {
      const outcome = field(after, "outcome");
      if (outcome === "pushed") return "Pushed to Xero";
      if (outcome === "already-pushed") return "Xero push requested: already in Xero";
      return `Xero push failed${field(after, "error") ? `: ${field(after, "error")}` : ""}`;
    }
    case "CLIENT_INVOICE_XERO_SYNC": {
      const state = field(after, "state");
      const reason = field(after, "reason");
      const paid = Number(field(after, "paymentsRecorded") ?? 0);
      const label: Record<string, string> = {
        IN_XERO: "Checked against Xero: in Xero",
        PAID_IN_XERO: "Checked against Xero: paid in Xero (recorded)",
        NEEDS_REVIEW: "Checked against Xero: needs review",
        UNKNOWN: "Checked against Xero: state unknown",
      };
      return `${label[state ?? ""] ?? "Checked against Xero"}${paid ? `, ${paid} payment${paid === 1 ? "" : "s"} recorded` : ""}${reason ? ` (${reason})` : ""}`;
    }
    case "CLIENT_INVOICE_BATCH_CREATED":
      return `Draft created by "Create drafts" from finished jobs${field(after, "includedJobCount") ? ` (${field(after, "includedJobCount")} jobs)` : ""}`;
    case "CLIENT_INVOICE_JOBS_ADDED":
      return `Finished jobs added: ${field(after, "jobNumbers") ?? `${field(after, "count") ?? "some"} jobs`}`;
    case "CLIENT_INVOICE_DRAFT_FIELDS":
      return `Draft details changed: ${field(after, "summary") ?? "bill to, period or due terms"}`;
    case "CLIENT_INVOICE_SEND_OPTIONS": {
      const push = field(after, "xeroPush");
      const link = field(after, "paymentLink");
      const parts = [
        link === "included" ? "payment link included" : null,
        push === "pushed" ? "pushed to Xero after sending" : null,
        push === "already-pushed" ? "already in Xero" : null,
        push === "failed" ? `push to Xero after sending failed${field(after, "xeroError") ? `: ${field(after, "xeroError")}` : ""}` : null,
      ].filter(Boolean);
      return `Send options: ${parts.join("; ") || "none"}`;
    }
    case "CLIENT_INVOICE_BLANK_CREATED":
      return "Created as a blank invoice";
    case "CLIENT_INVOICE_CREDIT_NOTE_CREATED":
      return `Credit note created against ${field(after, "creditsInvoiceNumber") ?? "an invoice"}`;
    default:
      return action;
  }
}

function auditEntry(row: AuditRow): HistoryEntry {
  return {
    id: `audit:${row.id}`,
    at: row.createdAt.toISOString(),
    label: describeInvoiceAudit(row.action, row.after),
    // A scheduled Xero check is stored under an administrator account (an
    // audit row needs a user) but was not done by that person.
    actor: auditActorLabel(row.after, row.user),
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
