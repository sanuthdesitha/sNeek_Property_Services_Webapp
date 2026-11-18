/**
 * Approved pay requests on the CLIENT's invoice (2026-11-18) — the database
 * half. The rules live in pure modules: what may be billed in
 * `lib/pay-adjustments/lifecycle.ts` (`clientChargeRefusal`), where it lands in
 * `./pay-request-client-plan.ts`, and how it reads in
 * `lib/pay-adjustments/invoice-text.ts`.
 *
 * NEVER TWICE. An extra is billed while `clientInvoiceLineId` is set. Every
 * stamp is a guarded `updateMany` on that column being null, inside the same
 * transaction that writes the line, under the client's invoice advisory lock —
 * the lock the generator and "Add finished jobs" already take. Voiding an
 * invoice releases the stamp (`releasePayRequestClientCharges`); removing the
 * line from a draft releases it through the foreign key (SetNull).
 *
 * ONLY DRAFTS CHANGE. An extra is folded into, or taken off, a line only while
 * that invoice is a DRAFT whose content may still change. An approved, sent,
 * paid or Xero invoice is never altered: the extra waits and lands on the next
 * invoice as its own line.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { listClientApprovals, type ClientApprovalRecord } from "@/lib/commercial/client-approvals";
import { invoiceContentLock } from "@/lib/billing/client-invoice-guards";
import { calculateShoppingAwareInvoiceTotals } from "@/lib/billing/shopping-client-charges";
import { LIVE_INVOICE_WHERE } from "@/lib/invoicing/invoiced-job-rule";
import {
  clientChargeRefusal,
  clientConsentState,
  type ClientConsentState,
} from "@/lib/pay-adjustments/lifecycle";
import { clientExtraText, recomposeFoldedClientLine } from "@/lib/pay-adjustments/invoice-text";
import {
  ownLineDescription,
  type PayRequestClientCharge,
  type PayRequestFold,
  type PayRequestOwnLine,
} from "@/lib/billing/pay-request-client-plan";

type Tx = Prisma.TransactionClient;

/** The latest client approval sent for each pay request (send-to-client). */
export function latestApprovalByPayRequest(approvals: readonly ClientApprovalRecord[]): Map<string, ClientApprovalRecord> {
  const latest = new Map<string, ClientApprovalRecord>();
  for (const approval of approvals) {
    const metadata = approval.metadata as Record<string, unknown> | null;
    const id = metadata?.source === "pay_adjustment" && typeof metadata.payAdjustmentId === "string" ? metadata.payAdjustmentId : null;
    if (!id) continue;
    const existing = latest.get(id);
    if (!existing || new Date(approval.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) latest.set(id, approval);
  }
  return latest;
}

export async function consentForPayRequest(adjustmentId: string): Promise<ClientConsentState> {
  const latest = latestApprovalByPayRequest(await listClientApprovals()).get(adjustmentId) ?? null;
  return clientConsentState(latest);
}

const CHARGE_SELECT = {
  id: true,
  status: true,
  jobId: true,
  propertyId: true,
  title: true,
  type: true,
  requestedHours: true,
  billToClient: true,
  clientAmount: true,
  clientDescription: true,
  reviewedAt: true,
  updatedAt: true,
  job: { select: { jobNumber: true, scheduledDate: true, propertyId: true, property: { select: { name: true, clientId: true } } } },
  property: { select: { name: true, clientId: true } },
} satisfies Prisma.CleanerPayAdjustmentSelect;

type ChargeRow = Prisma.CleanerPayAdjustmentGetPayload<{ select: typeof CHARGE_SELECT }>;

function sydneyDate(value: Date): string {
  return value.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" });
}

function toCharge(row: ChargeRow): PayRequestClientCharge {
  return {
    adjustmentId: row.id,
    jobId: row.jobId,
    propertyId: row.job?.propertyId ?? row.propertyId,
    amount: Number(row.clientAmount),
    title: row.title,
    clientDescription: row.clientDescription,
    type: row.type,
    requestedHours: row.requestedHours,
    job: row.job
      ? { propertyName: row.job.property?.name ?? null, date: sydneyDate(row.job.scheduledDate), jobNumber: row.job.jobNumber ?? null }
      : null,
  };
}

/**
 * Approved, client-billed extras of this client that no invoice carries yet
 * and that may be billed now (the client agreed, when they were asked).
 */
export async function loadPendingPayRequestCharges(
  input: { clientId: string; propertyId?: string | null; periodEnd?: Date | null; jobIds?: readonly string[] },
  database: Tx | typeof db = db,
): Promise<PayRequestClientCharge[]> {
  const rows = await database.cleanerPayAdjustment.findMany({
    where: {
      status: "APPROVED",
      billToClient: true,
      clientInvoiceLineId: null,
      ...(input.jobIds ? { jobId: { in: [...input.jobIds] } } : {}),
      OR: [
        { job: { property: { clientId: input.clientId, ...(input.propertyId ? { id: input.propertyId } : {}) } } },
        {
          jobId: null,
          property: { clientId: input.clientId },
          ...(input.propertyId ? { propertyId: input.propertyId } : {}),
          // An unlinked extra joins the first invoice whose period it was
          // approved in or before.
          ...(input.periodEnd ? { reviewedAt: { lte: input.periodEnd } } : {}),
        },
      ],
    },
    select: CHARGE_SELECT,
    orderBy: [{ reviewedAt: "asc" }, { id: "asc" }],
  });
  if (rows.length === 0) return [];
  const approvals = latestApprovalByPayRequest(await listClientApprovals());
  return rows
    .filter((row) =>
      clientChargeRefusal({
        status: row.status,
        billToClient: row.billToClient,
        clientAmount: row.clientAmount,
        consent: clientConsentState(approvals.get(row.id) ?? null),
        propertyHasClient: Boolean(row.job?.property?.clientId ?? row.property?.clientId),
      }) === null,
    )
    .map(toCharge);
}

const BILLABLE_GUARD = { clientInvoiceLineId: null, billToClient: true, status: "APPROVED" } as const;

async function stamp(tx: Tx, adjustmentId: string, lineId: string, amount: number, text: string) {
  const claim = await tx.cleanerPayAdjustment.updateMany({
    where: { id: adjustmentId, ...BILLABLE_GUARD },
    data: { clientInvoiceLineId: lineId, clientBilledAt: new Date(), clientBilledAmount: amount, clientBilledText: text },
  });
  if (claim.count !== 1) throw new Error("A pay request changed while the invoice was being written. Refresh and try again.");
}

/**
 * Stamp what a generated draft (or jobs added to a draft) folded in, and write
 * the extras' own lines. Runs inside the caller's transaction, after the job
 * lines exist.
 */
export async function writePayRequestCharges(
  tx: Tx,
  input: { invoiceId: string; folds: readonly PayRequestFold[]; ownLines: readonly PayRequestOwnLine[] },
): Promise<void> {
  if (input.folds.length > 0) {
    const lines = await tx.clientInvoiceLine.findMany({
      where: { invoiceId: input.invoiceId, jobId: { in: Array.from(new Set(input.folds.map((fold) => fold.jobId))) } },
      select: { id: true, jobId: true },
    });
    const lineByJob = new Map(lines.map((line) => [line.jobId, line.id]));
    for (const fold of input.folds) {
      const lineId = lineByJob.get(fold.jobId);
      if (!lineId) throw new Error("A job line went missing while the invoice was being written. Refresh and try again.");
      await stamp(tx, fold.adjustmentId, lineId, fold.amount, fold.text);
    }
  }
  for (const own of input.ownLines) {
    const { adjustmentId, ...line } = own;
    const created = await tx.clientInvoiceLine.create({ data: { ...line, invoiceId: input.invoiceId }, select: { id: true } });
    await stamp(tx, adjustmentId, created.id, own.lineTotal, own.description);
  }
}

/** Recompute an invoice's totals from its lines through the one totals rule. */
async function recomputeTotals(tx: Tx, invoiceId: string) {
  const invoice = await tx.clientInvoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { gstEnabled: true, kind: true } });
  const lines = await tx.clientInvoiceLine.findMany({ where: { invoiceId }, select: { category: true, lineTotal: true } });
  const totals = calculateShoppingAwareInvoiceTotals(lines, invoice.gstEnabled ?? true, { kind: invoice.kind });
  await tx.clientInvoice.update({
    where: { id: invoiceId },
    data: { subtotal: totals.subtotal, gstAmount: totals.gstAmount, totalAmount: totals.totalAmount },
  });
}

/** Release every extra a voided or deleted invoice carried, so it bills again. */
export async function releasePayRequestClientCharges(tx: Tx, invoiceId: string): Promise<number> {
  const released = await tx.cleanerPayAdjustment.updateMany({
    where: { clientInvoiceLine: { invoiceId } },
    data: { clientInvoiceLineId: null, clientBilledAt: null, clientBilledAmount: null, clientBilledText: null },
  });
  return released.count;
}

/** Where an extra stands on the client side, in words the office can act on. */
export type ClientBillingOutcome =
  | { state: "NOT_BILLED"; reason: string }
  | { state: "ON_DRAFT"; invoiceId: string; invoiceNumber: string; mode: "FOLDED" | "OWN_LINE" }
  | { state: "ON_ISSUED_INVOICE"; invoiceId: string; invoiceNumber: string; invoiceStatus: string }
  | { state: "WAITING_FOR_INVOICE"; reason: string };

const LINE_SELECT = {
  id: true,
  jobId: true,
  description: true,
  quantity: true,
  unitPrice: true,
  lineTotal: true,
  invoiceId: true,
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      kind: true,
      metadata: true,
      xeroInvoiceId: true,
      paidAt: true,
      paidAmount: true,
      clientId: true,
    },
  },
} satisfies Prisma.ClientInvoiceLineSelect;

type LineRow = Prisma.ClientInvoiceLineGetPayload<{ select: typeof LINE_SELECT }>;

function lineOnDraft(line: LineRow): boolean {
  return line.invoice.status === "DRAFT" && invoiceContentLock(line.invoice).editable;
}

/** The extras a line currently carries, as billed (amount + exact text). */
async function heldExtras(tx: Tx, lineId: string, excludeId?: string) {
  const rows = await tx.cleanerPayAdjustment.findMany({
    where: { clientInvoiceLineId: lineId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, clientBilledAmount: true, clientBilledText: true },
    orderBy: [{ clientBilledAt: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => ({ id: row.id, amount: Number(row.clientBilledAmount ?? 0), text: row.clientBilledText ?? "" }));
}

/** Take one extra off its draft line (or delete its own line). */
async function takeOff(tx: Tx, adjustmentId: string, line: LineRow) {
  if (line.jobId) {
    const current = await heldExtras(tx, line.id);
    const next = current.filter((part) => part.id !== adjustmentId);
    const composed = recomposeFoldedClientLine({ line, currentExtras: current, nextExtras: next });
    if (!composed) {
      throw new Error(
        `The line on draft ${line.invoice.invoiceNumber} was changed by hand and no longer holds this extra's amount. Edit that line on the invoice instead.`,
      );
    }
    await tx.clientInvoiceLine.update({ where: { id: line.id }, data: composed });
    await tx.cleanerPayAdjustment.update({
      where: { id: adjustmentId },
      data: { clientInvoiceLineId: null, clientBilledAt: null, clientBilledAmount: null, clientBilledText: null },
    });
  } else {
    // An own line: deleting it releases the stamp through the foreign key.
    await tx.clientInvoiceLine.delete({ where: { id: line.id } });
    await tx.cleanerPayAdjustment.updateMany({
      where: { id: adjustmentId },
      data: { clientBilledAt: null, clientBilledAmount: null, clientBilledText: null },
    });
  }
  await recomputeTotals(tx, line.invoiceId);
}

/** Put one extra onto a draft: fold into the job's line, or its own line. */
async function putOn(tx: Tx, row: ChargeRow, jobLine: LineRow): Promise<"FOLDED" | "OWN_LINE"> {
  const charge = toCharge(row);
  const text = clientExtraText(charge, charge.amount);
  if (jobLine.quantity === 1) {
    const current = await heldExtras(tx, jobLine.id);
    const composed = recomposeFoldedClientLine({
      line: jobLine,
      currentExtras: current,
      nextExtras: [...current, { amount: charge.amount, text }],
    });
    if (composed) {
      await tx.clientInvoiceLine.update({ where: { id: jobLine.id }, data: composed });
      await stamp(tx, row.id, jobLine.id, charge.amount, text);
      await recomputeTotals(tx, jobLine.invoiceId);
      return "FOLDED";
    }
  }
  const description = ownLineDescription(charge);
  const created = await tx.clientInvoiceLine.create({
    data: {
      invoiceId: jobLine.invoiceId,
      jobId: null,
      shoppingRunId: null,
      propertyId: charge.propertyId,
      description,
      quantity: 1,
      unitPrice: charge.amount,
      lineTotal: charge.amount,
      category: "SERVICE",
    },
    select: { id: true },
  });
  await stamp(tx, row.id, created.id, charge.amount, description);
  await recomputeTotals(tx, jobLine.invoiceId);
  return "OWN_LINE";
}

/**
 * Bring ONE request's client side in line with what is stored on it — called
 * after approval and after every edit. Takes it off a draft line when it should
 * no longer be billed (or its amount or wording changed), and folds it into
 * the job's draft line when it should be. An issued invoice is left exactly as
 * it is. Must run inside the caller's transaction.
 */
export async function reconcilePayRequestClientBilling(
  tx: Tx,
  adjustmentId: string,
  consent: ClientConsentState,
): Promise<ClientBillingOutcome> {
  const row = await tx.cleanerPayAdjustment.findUniqueOrThrow({
    where: { id: adjustmentId },
    select: { ...CHARGE_SELECT, clientInvoiceLineId: true, clientBilledAmount: true, clientBilledText: true },
  });
  const clientId = row.job?.property?.clientId ?? row.property?.clientId ?? null;
  if (clientId) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`client-invoice:${clientId}`}))`;
  }
  const refusal = clientChargeRefusal({
    status: row.status,
    billToClient: row.billToClient,
    clientAmount: row.clientAmount,
    consent,
    propertyHasClient: Boolean(clientId),
  });

  if (row.clientInvoiceLineId) {
    const line = await tx.clientInvoiceLine.findUnique({ where: { id: row.clientInvoiceLineId }, select: LINE_SELECT });
    if (line) {
      await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${line.invoiceId} FOR UPDATE`;
      if (!lineOnDraft(line)) {
        return { state: "ON_ISSUED_INVOICE", invoiceId: line.invoiceId, invoiceNumber: line.invoice.invoiceNumber, invoiceStatus: line.invoice.status };
      }
      const charge = toCharge(row);
      const unchanged =
        refusal === null &&
        Math.round(Number(row.clientBilledAmount) * 100) === Math.round(charge.amount * 100) &&
        (line.jobId ? row.clientBilledText === clientExtraText(charge, charge.amount) : row.clientBilledText === ownLineDescription(charge));
      if (unchanged) {
        return { state: "ON_DRAFT", invoiceId: line.invoiceId, invoiceNumber: line.invoice.invoiceNumber, mode: line.jobId ? "FOLDED" : "OWN_LINE" };
      }
      await takeOff(tx, row.id, line);
    }
  }

  if (refusal !== null) return { state: "NOT_BILLED", reason: refusal };

  const fresh = await tx.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: adjustmentId }, select: CHARGE_SELECT });
  if (!fresh.jobId) {
    return { state: "WAITING_FOR_INVOICE", reason: "Not linked to a job: it will be its own line on the client's next invoice." };
  }
  const jobLine = await tx.clientInvoiceLine.findFirst({
    where: { jobId: fresh.jobId, invoice: { ...LIVE_INVOICE_WHERE, ...(clientId ? { clientId } : {}) } },
    select: LINE_SELECT,
    orderBy: { createdAt: "desc" },
  });
  if (!jobLine) {
    return { state: "WAITING_FOR_INVOICE", reason: "The job is not on a client invoice yet: the extra will be added to the job's line when it is invoiced." };
  }
  await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${jobLine.invoiceId} FOR UPDATE`;
  if (!lineOnDraft(jobLine)) {
    return {
      state: "WAITING_FOR_INVOICE",
      reason: `The job is on client invoice ${jobLine.invoice.invoiceNumber}, which is no longer a draft, so it is not changed. The extra will appear on the client's next invoice.`,
    };
  }
  const mode = await putOn(tx, fresh, jobLine);
  return { state: "ON_DRAFT", invoiceId: jobLine.invoiceId, invoiceNumber: jobLine.invoice.invoiceNumber, mode };
}

/** The client invoice line an extra sits on, for lock checks and display. */
export async function clientLineFacts(lineId: string | null, database: Tx | typeof db = db) {
  if (!lineId) return null;
  const line = await database.clientInvoiceLine.findUnique({ where: { id: lineId }, select: LINE_SELECT });
  if (!line) return null;
  return {
    invoiceId: line.invoiceId,
    invoiceNumber: line.invoice.invoiceNumber,
    invoiceStatus: line.invoice.status,
    contentEditable: invoiceContentLock(line.invoice).editable,
    folded: Boolean(line.jobId),
  };
}
