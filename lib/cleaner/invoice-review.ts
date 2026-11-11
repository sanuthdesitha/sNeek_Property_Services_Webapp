/**
 * Data for the read-only cleaner invoice review page: the row (list shape),
 * the stage bar, the history from audit rows and, for an invoice still being
 * decided, the current submitted-vs-expected comparison for its payee and
 * period. Each part fails on its own and says so; nothing is filled in.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { EStage } from "@/components/v2/ui/stage-bar";
import { db } from "@/lib/db";
import { getExpectedInvoicesForPeriod, type ExpectedCleanerInvoice } from "./expected-invoice";
import { withPayees } from "./invoice-admin-list";
import type { CleanerInvoiceRow } from "./invoice-admin-list-types";
import { CLEANER_INVOICE_STATUS_LABEL, type CleanerInvoiceStatus } from "./invoice-transitions";

export type CleanerHistoryEntry = { id: string; at: string; label: string; actor: string | null };

export type CleanerStageView =
  | { terminal: { title: string; description: string }; stages: [] }
  | { terminal: null; stages: EStage[] };

export type CleanerExpectedComparison =
  | { status: "ready"; expected: ExpectedCleanerInvoice | null; start: string; end: string }
  | { status: "not-applicable"; reason: string }
  | { status: "error"; message: string };

export type CleanerInvoiceReview = {
  row: CleanerInvoiceRow;
  stages: CleanerStageView;
  history: CleanerHistoryEntry[] | { error: string };
  comparison: CleanerExpectedComparison;
};

/** Stages from stored state; approval of a legacy row (no audit) reads "passed", not done. */
export function cleanerInvoiceStages(row: Pick<CleanerInvoiceRow, "status" | "xeroBillId">, approvedAt: string | null): CleanerStageView {
  const status = row.status as CleanerInvoiceStatus;
  if (status === "VOID") return { terminal: { title: "Reversed", description: "Cancelled. Its work was handed back so the payee can bill it on a new invoice." }, stages: [] };
  if (status === "CHANGES_REQUESTED") return { terminal: { title: "Sent back for changes", description: "Released to the payee to correct and resend as a new submission." }, stages: [] };
  if (status === "SENDING") return { terminal: { title: "Delivery review", description: "The payee's send was interrupted. Its money is reserved until the office reviews delivery." }, stages: [] };
  const after = status !== "SUBMITTED";
  const approved: EStage = status === "APPROVED"
    ? { key: "approved", label: "Approved", state: "current" }
    : status === "SUBMITTED"
      ? { key: "approved", label: "Approved", state: "todo" }
      : { key: "approved", label: "Approved", state: approvedAt ? "done" : "passed", note: approvedAt ? null : "Before approval existed" };
  const xero: EStage = row.xeroBillId
    ? { key: "xero", label: "In Xero", state: "done" }
    : status === "XERO_EXPORTING"
      ? { key: "xero", label: "In Xero", state: "pending", note: "Pending or failed" }
      : status === "PAID"
        ? { key: "xero", label: "In Xero", state: "skipped", note: "Not in Xero" }
        : { key: "xero", label: "In Xero", state: "todo" };
  const paid: EStage = status === "PAID"
    ? { key: "paid", label: "Paid", state: "done" }
    : status === "PAID_CLAIMED"
      ? { key: "paid", label: "Paid", state: "current", note: "Claimed by payee" }
      : { key: "paid", label: "Paid", state: "todo" };
  return { terminal: null, stages: [{ key: "submitted", label: "Submitted", state: after ? "done" : "current" }, approved, xero, paid] };
}

const field = (after: unknown, key: string): string | null => {
  const value = after && typeof after === "object" ? (after as Record<string, unknown>)[key] : null;
  return typeof value === "string" && value.trim() ? value : typeof value === "number" ? String(value) : null;
};

export function describeCleanerAudit(action: string, after: unknown): string {
  const status = field(after, "status") as CleanerInvoiceStatus | null;
  const label = status ? CLEANER_INVOICE_STATUS_LABEL[status] ?? status : "a new state";
  switch (action) {
    case "CLEANER_INVOICE_STATUS_UPDATE": {
      if (field(after, "action") === "push-xero") return "Pushed to Xero as a draft bill";
      if (status === "APPROVED") return "Approved";
      if (status === "PAID") return `Payment recorded${field(after, "paidAmount") ? ` (${new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(field(after, "paidAmount")))})` : ""}`;
      if (status === "CHANGES_REQUESTED") return `Sent back for changes${field(after, "changesNote") ? `: ${field(after, "changesNote")}` : ""}`;
      return `Moved to ${label}`;
    }
    case "CLEANER_INVOICE_PAY_CLAIMED":
      return "Payee said it has been paid";
    case "CLEANER_INVOICE_DELIVERY_REVIEWED":
      return `Delivery reviewed: ${field(after, "resolution") === "CONFIRMED_SENT" ? "confirmed received" : "confirmed not delivered"}`;
    default:
      return action;
  }
}

async function readHistory(row: CleanerInvoiceRow): Promise<{ entries: CleanerHistoryEntry[]; approvedAt: string | null } | { error: string }> {
  try {
    const rows = await db.auditLog.findMany({
      where: { entity: "CleanerInvoiceSubmission", entityId: row.id },
      select: { id: true, action: true, after: true, createdAt: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const entries: CleanerHistoryEntry[] = rows.map((audit) => ({
      id: audit.id,
      at: audit.createdAt.toISOString(),
      label: describeCleanerAudit(audit.action, audit.after),
      actor: audit.user?.name || audit.user?.email || null,
    }));
    entries.push({ id: "record:created", at: row.createdAt, label: "Submitted by the payee", actor: row.cleanerName });
    const approval = rows.find((audit) => audit.action === "CLEANER_INVOICE_STATUS_UPDATE" && field(audit.after, "status") === "APPROVED");
    return { entries: entries.sort((a, b) => b.at.localeCompare(a.at)), approvedAt: approval ? approval.createdAt.toISOString() : null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "History could not be read." };
  }
}

/** Only meaningful while the invoice is still being decided: the forecast covers unpaid work. */
async function readComparison(row: CleanerInvoiceRow): Promise<CleanerExpectedComparison> {
  if (!["SUBMITTED", "APPROVED", "XERO_PUSHED", "XERO_EXPORTING"].includes(row.status)) {
    return { status: "not-applicable", reason: "Shown only while an invoice is waiting to be approved, exported or paid." };
  }
  const start = formatInTimeZone(new Date(row.periodStart), "Australia/Sydney", "yyyy-MM-dd");
  const end = formatInTimeZone(new Date(row.periodEnd), "Australia/Sydney", "yyyy-MM-dd");
  try {
    const result = await getExpectedInvoicesForPeriod({ startDate: start, endDate: end, cleanerId: row.cleanerId });
    return { status: "ready", expected: result.cleaners.find((cleaner) => cleaner.cleanerId === row.cleanerId) ?? null, start, end };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The comparison could not be computed." };
  }
}

export async function loadCleanerInvoiceReview(id: string): Promise<CleanerInvoiceReview | null> {
  const submission = await db.cleanerInvoiceSubmission.findUnique({ where: { id } });
  if (!submission) return null;
  const [row] = await withPayees([submission]);
  const [history, comparison] = await Promise.all([readHistory(row), readComparison(row)]);
  const approvedAt = "error" in history ? null : history.approvedAt;
  return {
    row,
    stages: cleanerInvoiceStages(row, approvedAt),
    history: "error" in history ? history : history.entries,
    comparison,
  };
}
