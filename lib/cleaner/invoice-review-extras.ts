/**
 * The parts of the cleaner invoice review page added by the 2026-11-17 board
 * ("Cleaner invoice"): the lines as submitted with their rate snapshots, the
 * pay requests behind the pay-rule band, and the Xero card. Read only: every
 * amount is the stored one; nothing is recomputed or pushed.
 */
import { db } from "@/lib/db";
import { listClientApprovals } from "@/lib/commercial/client-approvals";
import { ACCOUNTABILITY_SOURCES } from "@/lib/admin/approvals/sources";
import { cleanerRequestedAmount, clientChargeView, type ClientChargeView } from "@/lib/payroll/cleaner-pay-amount";
import { getXeroStatus } from "@/lib/xero/client";
import { cleanerBillLineKind, planCleanerBillAccounts, type CleanerBillLineKind } from "@/lib/xero/cleaner-bill-accounts";
import { getPhase3IntegrationsSettings } from "@/lib/phase3/integrations";
import { xeroAccountName } from "@/lib/billing/xero-account-name";
import type { CleanerInvoiceRow } from "./invoice-admin-list-types";

/** One stored line, as the payee sent it. */
export type CleanerInvoiceLineView = {
  index: number;
  description: string;
  /** Hours stored on the line (older snapshots); null when the snapshot has none. */
  hours: number | null;
  /** The job assignment's stored rate, when the line is matched to its job. */
  rateSnapshot: number | null;
  /** The stored amount; null when the line has none. */
  amount: number | null;
  jobId: string | null;
  jobNumber: string | null;
};

export type CleanerPayRequestView = {
  id: string;
  title: string;
  jobNumber: string | null;
  /** What the payee asked for. Null when it is not stored. */
  requestedAmount: number | null;
  /** What the payee is paid (the approved amount). Null when it is not stored. */
  paidAmount: number | null;
  decidedAt: string | null;
  decidedBy: string | null;
  /** The client charge, read only. Null when never sent to the client or not visible to this viewer. */
  clientCharge: ClientChargeView | null;
};

export type CleanerXeroConnection =
  | { status: "connected"; tenantName: string; lastRefreshedAt: string | null }
  | { status: "attention"; tenantName: string; reason: string | null }
  | { status: "not-connected" }
  | { status: "error"; message: string };

/** Which Xero account the bill's lines go to (Settings › Money › Xero › Cleaner bills). */
export type CleanerBillAccountsView =
  | { status: "not-set"; reason: string }
  | { status: "set"; groups: Array<{ label: string; code: string; lines: number; name: string | null; nameReason: string | null }> }
  | { status: "error"; message: string };

export type CleanerXeroView = {
  /** pushed: a bill id is stored. pending: a push started and did not finish. none: not in Xero. */
  state: "pushed" | "pending" | "none";
  billId: string | null;
  exportedAt: string | null;
  /** The last recorded push failure, with the reason Xero or the network gave. */
  lastFailure: { at: string; reason: string } | null;
  connection: CleanerXeroConnection;
  /** Optional so older callers and fixtures stay valid; the review page always reads it. */
  accounts?: CleanerBillAccountsView;
};

type StoredLine = { description?: unknown; label?: unknown; jobNumber?: unknown; hours?: unknown; amount?: unknown; unitAmount?: unknown; quantity?: unknown };

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function storedLines(lineData: unknown): StoredLine[] {
  if (Array.isArray(lineData)) return lineData as StoredLine[];
  const lines = (lineData as { lines?: unknown } | null)?.lines;
  return Array.isArray(lines) ? (lines as StoredLine[]) : [];
}

function storedJobIds(lineData: unknown): string[] {
  const ids = (lineData as { jobIds?: unknown } | null)?.jobIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/** The amount the line stores: `amount`, else its unit amount times quantity as written at send time. */
function storedLineAmount(line: StoredLine): number | null {
  const amount = finiteOrNull(line.amount);
  if (amount !== null) return amount;
  const unit = finiteOrNull(line.unitAmount);
  if (unit === null) return null;
  const quantity = finiteOrNull(line.quantity) ?? 1;
  return Math.round(unit * quantity * 100) / 100;
}

/**
 * Lines with rate snapshots. Job lines were written first and in the same
 * order as `jobIds` (app/api/cleaner/invoice/send/route.ts), but a line is
 * matched to its job only when its description names that job's property, so
 * a snapshot whose order differs shows "–" rather than another job's rate.
 */
export async function cleanerInvoiceLines(row: Pick<CleanerInvoiceRow, "cleanerId" | "lineData">): Promise<CleanerInvoiceLineView[]> {
  const lines = storedLines(row.lineData);
  const jobIds = storedJobIds(row.lineData);
  const jobs = jobIds.length
    ? await db.job.findMany({
        where: { id: { in: jobIds } },
        select: { id: true, jobNumber: true, property: { select: { name: true } }, assignments: { where: { userId: row.cleanerId }, select: { payRate: true } } },
      })
    : [];
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  return lines.map((line, index) => {
    const description = String(line.description ?? line.label ?? line.jobNumber ?? "Line");
    const job = index < jobIds.length ? jobById.get(jobIds[index]) : undefined;
    const matches = Boolean(job?.property?.name && description.includes(job.property.name));
    return {
      index,
      description,
      hours: finiteOrNull(line.hours),
      rateSnapshot: matches ? finiteOrNull(job?.assignments[0]?.payRate) : null,
      amount: storedLineAmount(line),
      jobId: matches ? job!.id : null,
      jobNumber: matches ? job!.jobNumber ?? null : null,
    };
  });
}

/**
 * Pay requests this invoice billed (stamped with its id). Rectifications and
 * bonuses have their own queues and are not pay requests. The client charge is
 * read only and only for a viewer with finance access.
 */
export async function cleanerInvoicePayRequests(invoiceId: string, options: { showClientCharge: boolean }): Promise<CleanerPayRequestView[]> {
  const rows = await db.cleanerPayAdjustment.findMany({
    where: { includedInCleanerInvoiceId: invoiceId, OR: [{ source: null }, { source: { notIn: [...ACCOUNTABILITY_SOURCES] } }] },
    select: {
      id: true,
      title: true,
      requestedAmount: true,
      approvedAmount: true,
      reviewedAt: true,
      reviewedById: true,
      job: { select: { jobNumber: true } },
    },
    orderBy: { requestedAt: "asc" },
  });
  if (!rows.length) return [];
  const reviewerIds = Array.from(new Set(rows.map((row) => row.reviewedById).filter((id): id is string => Boolean(id))));
  const reviewers = reviewerIds.length ? await db.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true, email: true } }) : [];
  const reviewerName = new Map(reviewers.map((user) => [user.id, user.name || user.email]));
  const approvals = options.showClientCharge ? await listClientApprovals() : [];
  const approvalByAdjustment = new Map<string, (typeof approvals)[number]>();
  for (const approval of approvals) {
    const adjustmentId = (approval.metadata as { payAdjustmentId?: unknown } | null)?.payAdjustmentId;
    if (typeof adjustmentId !== "string") continue;
    const existing = approvalByAdjustment.get(adjustmentId);
    if (!existing || existing.updatedAt < approval.updatedAt) approvalByAdjustment.set(adjustmentId, approval);
  }
  return rows.map((row) => ({
    id: row.id,
    title: row.title?.trim() || "Pay request",
    jobNumber: row.job?.jobNumber ?? null,
    requestedAmount: cleanerRequestedAmount(row),
    paidAmount: finiteOrNull(row.approvedAmount),
    decidedAt: row.reviewedAt?.toISOString() ?? null,
    decidedBy: row.reviewedById ? reviewerName.get(row.reviewedById) ?? null : null,
    clientCharge: options.showClientCharge ? clientChargeView(approvalByAdjustment.get(row.id) ?? null) : null,
  }));
}

async function xeroConnection(): Promise<CleanerXeroConnection> {
  try {
    const status = await getXeroStatus();
    if (!status) return { status: "not-connected" };
    if (status.connected && status.state === "connected") {
      return { status: "connected", tenantName: status.tenantName, lastRefreshedAt: status.lastRefreshedAt };
    }
    return { status: "attention", tenantName: status.tenantName, reason: status.reason };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "The Xero connection could not be read." };
  }
}

const KIND_LABEL: Record<CleanerBillLineKind, string> = { LABOUR: "Cleaning work", INSPECTION: "QA inspections", REIMBURSEMENT: "Reimbursements" };

/**
 * The account each kind of line on this bill goes to, with the account's name
 * from Xero when it can be read (the invoice editor's cached read; a failure is
 * shown with its reason). Not set: the push is refused, and the card says so.
 */
async function cleanerBillAccounts(lineData: unknown): Promise<CleanerBillAccountsView> {
  try {
    const lines = storedLines(lineData);
    const settings = (await getPhase3IntegrationsSettings()).xero;
    const plan = planCleanerBillAccounts(lines, settings);
    if (!plan.ok) return { status: "not-set", reason: plan.reason };
    const counts = new Map<string, { label: string; code: string; lines: number }>();
    lines.forEach((line, index) => {
      const label = KIND_LABEL[cleanerBillLineKind(line)];
      const code = plan.codes[index];
      const key = `${label}:${code}`;
      const entry = counts.get(key) ?? { label, code, lines: 0 };
      entry.lines += 1;
      counts.set(key, entry);
    });
    if (counts.size === 0) counts.set(`${KIND_LABEL.LABOUR}:${plan.labourCode}`, { label: KIND_LABEL.LABOUR, code: plan.labourCode, lines: 0 });
    const groups = await Promise.all(Array.from(counts.values()).map(async (group) => {
      const name = await xeroAccountName(group.code);
      return { ...group, name: name.name, nameReason: name.reason };
    }));
    return { status: "set", groups };
  } catch (error) {
    return { status: "error", message: error instanceof Error && error.message ? error.message : "The Xero account settings could not be read." };
  }
}

/** The Xero card: stored bill, a push that did not finish, the connection (token store) and the bill's accounts. */
export async function cleanerInvoiceXero(row: Pick<CleanerInvoiceRow, "id" | "status" | "xeroBillId" | "xeroExportedAt"> & { lineData?: unknown }): Promise<CleanerXeroView> {
  const failure = await db.auditLog.findFirst({
    where: { entity: "CleanerInvoiceSubmission", entityId: row.id, action: "CLEANER_INVOICE_XERO_PUSH_FAILED" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, after: true },
  });
  const reason = (failure?.after as { reason?: unknown } | null)?.reason;
  const state: CleanerXeroView["state"] = row.xeroBillId ? "pushed" : row.status === "XERO_EXPORTING" ? "pending" : "none";
  return {
    state,
    billId: row.xeroBillId,
    exportedAt: row.xeroExportedAt,
    lastFailure: failure && !row.xeroBillId ? { at: failure.createdAt.toISOString(), reason: typeof reason === "string" && reason ? reason : "No reason was recorded." } : null,
    connection: await xeroConnection(),
    accounts: await cleanerBillAccounts(row.lineData ?? null),
  };
}
