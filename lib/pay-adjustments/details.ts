/**
 * Everything about ONE pay request, for the office (2026-11-18).
 *
 * Owner request: "pay requests should show full details after approval as
 * well to see what it was for". A decided request used to collapse to a status
 * chip; this loader answers every question about it in one place — what was
 * asked, for which job, what was decided by whom, where the money was settled,
 * what the client is billed and the full edit history — with each lock and
 * refusal already in words, from the same pure rules the routes enforce.
 *
 * Office only: it carries the private note and the client amount. The cleaner
 * reads their own requests through the allowlist DTO in
 * app/api/cleaner/pay-adjustments/route.ts.
 */
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/s3";
import { listClientApprovals } from "@/lib/commercial/client-approvals";
import { LIVE_INVOICE_WHERE } from "@/lib/invoicing/invoiced-job-rule";
import { clientLineFacts, latestApprovalByPayRequest } from "@/lib/billing/pay-request-client-billing";
import {
  clientBillingLock,
  clientChargeRefusal,
  clientConsentState,
  isClientLineOnDraft,
  markPaidRefusal,
  payRequestEditLock,
  payRequestSettlement,
  settlementSentence,
  undoPaidRefusal,
  type ClientConsentState,
} from "@/lib/pay-adjustments/lifecycle";
import { PAY_REQUEST_HISTORY_ACTIONS, payRequestHistory, type PayRequestHistoryEntry } from "@/lib/pay-adjustments/history";

export type ClientBillingState = "NOT_BILLED" | "ON_DRAFT" | "ON_INVOICE" | "WAITING";

export interface PayRequestClientView {
  billToClient: boolean;
  clientAmount: number | null;
  clientDescription: string | null;
  consent: ClientConsentState;
  state: ClientBillingState;
  invoiceId: string | null;
  invoiceNumber: string | null;
  /** The billing state in words: "On draft INV-0042, added to the job's line." */
  sentence: string;
  /** Null when the client side may still change; otherwise why not. */
  lockReason: string | null;
}

export interface PayRequestDetails {
  id: string;
  title: string | null;
  type: string;
  category: string;
  taxable: boolean;
  status: string;
  source: string | null;
  requestedHours: number | null;
  requestedRate: number | null;
  requestedAmount: number;
  approvedAmount: number | null;
  cleanerNote: string | null;
  decisionMessage: string | null;
  adminNote: string | null;
  attachments: Array<{ key: string; url: string }>;
  requestedAt: string;
  reviewedAt: string | null;
  reviewedByName: string | null;
  cleaner: { id: string; name: string };
  job: { id: string; jobNumber: string | null; scheduledDate: string; propertyId: string; propertyName: string } | null;
  property: { id: string; name: string } | null;
  settlement: { kind: string | null; sentence: string };
  paidOutside: { date: string | null; method: string | null; reference: string | null; note: string | null } | null;
  editLock: { editable: boolean; reason: string | null };
  markPaid: { allowed: boolean; reason: string | null };
  undoPaid: { allowed: boolean; reason: string | null };
  client: PayRequestClientView;
  history: PayRequestHistoryEntry[];
}

function attachmentList(raw: unknown): Array<{ key: string; url: string }> {
  return Array.isArray(raw)
    ? raw
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((key) => ({ key, url: publicUrl(key) }))
    : [];
}

export async function loadPayRequestDetails(id: string): Promise<PayRequestDetails | null> {
  const row = await db.cleanerPayAdjustment.findUnique({
    where: { id },
    include: {
      cleaner: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { name: true, email: true } },
      job: { select: { id: true, jobNumber: true, scheduledDate: true, propertyId: true, property: { select: { name: true, clientId: true } } } },
      property: { select: { id: true, name: true, clientId: true } },
    },
  });
  if (!row) return null;

  const [cleanerInvoice, payrollRun, audits, approvals, line] = await Promise.all([
    row.includedInCleanerInvoiceId
      ? db.cleanerInvoiceSubmission.findUnique({ where: { id: row.includedInCleanerInvoiceId }, select: { invoiceNumber: true, status: true } })
      : null,
    row.includedInPayrollRunId
      ? db.payrollRun.findUnique({ where: { id: row.includedInPayrollRunId }, select: { periodStart: true, periodEnd: true } }).catch(() => null)
      : null,
    db.auditLog.findMany({
      where: { entity: "CleanerPayAdjustment", entityId: id, action: { in: [...PAY_REQUEST_HISTORY_ACTIONS] } },
      select: { action: true, createdAt: true, before: true, after: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    listClientApprovals(),
    clientLineFacts(row.clientInvoiceLineId),
  ]);

  const labels = {
    cleanerInvoiceNumber: cleanerInvoice?.invoiceNumber ?? null,
    cleanerInvoiceStatus: cleanerInvoice?.status ?? null,
    payrollRunLabel: payrollRun
      ? `${payrollRun.periodStart.toISOString().slice(0, 10)} to ${payrollRun.periodEnd.toISOString().slice(0, 10)}`
      : null,
  };
  const settlement = payRequestSettlement(row);
  const editLock = payRequestEditLock(row, labels);
  const markPaidWhy = markPaidRefusal(row, labels);
  const undoWhy = undoPaidRefusal(row);
  const consent = clientConsentState(latestApprovalByPayRequest(approvals).get(row.id) ?? null);
  const clientId = row.job?.property?.clientId ?? row.property?.clientId ?? null;

  const client = await clientView({
    row: {
      status: row.status,
      jobId: row.jobId,
      billToClient: row.billToClient,
      clientAmount: row.clientAmount,
      clientDescription: row.clientDescription,
    },
    clientId,
    consent,
    line,
  });

  return {
    id: row.id,
    title: row.title,
    type: String(row.type),
    category: row.category,
    taxable: row.taxable,
    status: String(row.status),
    source: row.source,
    requestedHours: row.requestedHours,
    requestedRate: row.requestedRate,
    requestedAmount: row.requestedAmount,
    approvedAmount: row.approvedAmount,
    cleanerNote: row.cleanerNote,
    decisionMessage: row.decisionMessage,
    adminNote: row.adminNote,
    attachments: attachmentList(row.attachmentKeys),
    requestedAt: row.requestedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedByName: row.reviewedBy?.name ?? row.reviewedBy?.email ?? null,
    cleaner: { id: row.cleaner.id, name: row.cleaner.name ?? row.cleaner.email },
    job: row.job
      ? {
          id: row.job.id,
          jobNumber: row.job.jobNumber ?? null,
          scheduledDate: row.job.scheduledDate.toISOString(),
          propertyId: row.job.propertyId,
          propertyName: row.job.property?.name ?? "",
        }
      : null,
    property: row.property ? { id: row.property.id, name: row.property.name } : null,
    settlement: { kind: settlement?.kind ?? null, sentence: settlementSentence(settlement, labels) },
    paidOutside: row.paidOutsideAt
      ? {
          date: row.paidOutsideDate ? row.paidOutsideDate.toISOString().slice(0, 10) : null,
          method: row.paidOutsideMethod,
          reference: row.paidOutsideReference,
          note: row.paidOutsideNote,
        }
      : null,
    editLock: editLock.editable ? { editable: true, reason: null } : { editable: false, reason: editLock.reason },
    markPaid: { allowed: markPaidWhy === null, reason: markPaidWhy },
    undoPaid: { allowed: undoWhy === null, reason: undoWhy },
    client,
    history: payRequestHistory(
      audits.map((audit) => ({ ...audit, actorName: audit.user?.name ?? audit.user?.email ?? null })),
      "internal",
    ),
  };
}

async function clientView(input: {
  row: { status: string; jobId: string | null; billToClient: boolean; clientAmount: number | null; clientDescription: string | null };
  clientId: string | null;
  consent: ClientConsentState;
  line: Awaited<ReturnType<typeof clientLineFacts>>;
}): Promise<PayRequestClientView> {
  const base = {
    billToClient: input.row.billToClient,
    clientAmount: input.row.clientAmount,
    clientDescription: input.row.clientDescription,
    consent: input.consent,
  };
  const lock = clientBillingLock(input.line);
  const lockReason = lock.editable ? null : lock.reason;
  if (input.line) {
    const onDraft = isClientLineOnDraft(input.line);
    return {
      ...base,
      state: onDraft ? "ON_DRAFT" : "ON_INVOICE",
      invoiceId: input.line.invoiceId,
      invoiceNumber: input.line.invoiceNumber,
      sentence: onDraft
        ? `On draft client invoice ${input.line.invoiceNumber}, ${input.line.folded ? "added to the job's line" : "as its own line"}.`
        : `Billed on client invoice ${input.line.invoiceNumber} (${input.line.invoiceStatus.toLowerCase().replace(/_/g, " ")}).`,
      lockReason,
    };
  }
  const refusal = clientChargeRefusal({
    status: input.row.status,
    billToClient: input.row.billToClient,
    clientAmount: input.row.clientAmount,
    consent: input.consent,
    propertyHasClient: Boolean(input.clientId),
  });
  if (refusal) return { ...base, state: "NOT_BILLED", invoiceId: null, invoiceNumber: null, sentence: refusal, lockReason };
  if (!input.row.jobId) {
    return { ...base, state: "WAITING", invoiceId: null, invoiceNumber: null, sentence: "Waiting for the client's next invoice, as its own line.", lockReason };
  }
  const jobLine = await db.clientInvoiceLine.findFirst({
    where: { jobId: input.row.jobId, invoice: { ...LIVE_INVOICE_WHERE, ...(input.clientId ? { clientId: input.clientId } : {}) } },
    select: { invoice: { select: { invoiceNumber: true } } },
    orderBy: { createdAt: "desc" },
  });
  return {
    ...base,
    state: "WAITING",
    invoiceId: null,
    invoiceNumber: null,
    sentence: jobLine
      ? `Waiting for the client's next invoice: the job is on ${jobLine.invoice.invoiceNumber}, which is no longer a draft and is not changed.`
      : "Will be added to the job's line when the job is invoiced.",
    lockReason,
  };
}
