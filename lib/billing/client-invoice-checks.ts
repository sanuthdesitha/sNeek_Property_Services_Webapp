/**
 * "Before you approve": the checks shown beside a draft, computed on the server
 * from the same functions the approve request runs, so the list can never say
 * OK where approval would be refused.
 *
 * Enforced by the approve PATCH (client-invoice-patch.ts):
 *   - a pending Xero export reservation (isXeroExportPending)
 *   - the started-work review (startedWorkRefusal, read without the job locks)
 * Not enforced by approval, shown as "Check" only:
 *   - every job line still resolves a client rate (computeClientCharge, the
 *     generator's missing-rate rule)
 *   - no job is on another live invoice (billedJobLinesWhere, the generator's
 *     double-billing rule)
 *   - the stored total matches the lines (invoiceTotalsMismatch)
 * A check that cannot be read is "unknown", never OK.
 */
import { db } from "@/lib/db";
import { computeClientCharge } from "@/lib/finance/job-money";
import { billedJobLinesWhere, invoiceTotalsMismatch } from "./client-invoices";
import { isXeroExportPending } from "./client-invoice-guards";
import { startedWorkRefusal } from "./started-work-reconciliation";
import type { ApprovalCheck, ApprovalChecks } from "./client-invoice-editor-types";

export type CheckableInvoice = {
  id: string;
  status: string;
  clientId: string;
  metadata: unknown;
  gstEnabled: boolean | null;
  totalAmount: number;
  lines: Array<{ id: string; jobId: string | null; quantity: number; unitPrice: number; lineTotal: number; category: string }>;
};

type CheckClient = Pick<typeof db, "job" | "propertyClientRate" | "priceBook" | "clientInvoiceLine" | "$queryRaw">;

function failed(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The check could not be completed.";
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function jobIdsOf(invoice: CheckableInvoice): string[] {
  return Array.from(new Set(invoice.lines.flatMap((line) => (line.jobId ? [line.jobId] : []))));
}

export async function xeroReservationCheck(invoice: CheckableInvoice): Promise<ApprovalCheck> {
  const pending = isXeroExportPending(invoice.metadata);
  return {
    key: "xero-reservation",
    state: pending ? "refused" : "ok",
    enforced: true,
    label: pending ? "A Xero export is pending or failed" : "No Xero export is pending",
    detail: pending ? "Retry the Xero push before approving or editing." : null,
  };
}

export async function startedWorkCheck(invoice: CheckableInvoice, client: CheckClient): Promise<ApprovalCheck> {
  let reason: string | null;
  try {
    reason = await startedWorkRefusal(invoice, client as never, true, { lockJobs: false });
  } catch (error) {
    // The approve request throws the same error, so it is refused too.
    reason = failed(error);
  }
  const hasReview = Boolean((invoice.metadata as { startedWorkReview?: unknown } | null)?.startedWorkReview);
  if (reason) return { key: "started-work", state: "refused", enforced: true, label: "Started work needs review", detail: reason };
  return {
    key: "started-work",
    state: "ok",
    enforced: true,
    label: hasReview ? "Started work has a current office review" : "No started-work pricing on this invoice",
    detail: null,
  };
}

export async function ratesCheck(invoice: CheckableInvoice, client: CheckClient): Promise<ApprovalCheck> {
  const ids = jobIdsOf(invoice);
  const base = { key: "rates" as const, enforced: false };
  if (ids.length === 0) return { ...base, state: "ok", label: "No job lines to rate", detail: null };
  try {
    const [jobs, propertyRates, priceBook] = await Promise.all([
      client.job.findMany({
        where: { id: { in: ids } },
        select: { id: true, jobNumber: true, jobType: true, propertyId: true, fixedPrice: true },
      }),
      client.propertyClientRate.findMany({ where: { property: { clientId: invoice.clientId }, isActive: true } }),
      client.priceBook.findMany({ where: { isActive: true }, select: { jobType: true, baseRate: true } }),
    ]);
    const missingJobs = ids.length - jobs.length;
    const unrated = jobs.filter((job) => computeClientCharge(job, { propertyRates, priceBook }).rateMissing);
    if (missingJobs > 0) {
      return { ...base, state: "unknown", label: `${plural(missingJobs, "job")} on this invoice could not be found`, detail: null };
    }
    if (unrated.length > 0) {
      const names = unrated.map((job) => job.jobNumber ?? job.id).join(", ");
      return { ...base, state: "check", label: `${plural(unrated.length, "job")} now have no client rate`, detail: names };
    }
    return { ...base, state: "ok", label: `All ${plural(jobs.length, "job")} have a client rate`, detail: null };
  } catch (error) {
    return { ...base, state: "unknown", label: "Rates could not be checked", detail: failed(error) };
  }
}

export async function otherInvoiceCheck(invoice: CheckableInvoice, client: CheckClient): Promise<ApprovalCheck> {
  const ids = jobIdsOf(invoice);
  const base = { key: "other-invoice" as const, enforced: false };
  const repeated = invoice.lines.filter((line) => line.jobId).length - ids.length;
  if (ids.length === 0) return { ...base, state: "ok", label: "No job lines on this invoice", detail: null };
  try {
    const elsewhere = await client.clientInvoiceLine.findMany({
      where: { AND: [billedJobLinesWhere(invoice.clientId), { jobId: { in: ids } }, { invoiceId: { not: invoice.id } }] },
      select: { jobId: true, invoice: { select: { invoiceNumber: true } } },
    });
    if (elsewhere.length > 0) {
      const numbers = Array.from(new Set(elsewhere.map((line) => line.invoice.invoiceNumber))).join(", ");
      const jobs = new Set(elsewhere.map((line) => line.jobId)).size;
      return { ...base, state: "check", label: `${plural(jobs, "job")} also on another invoice`, detail: numbers };
    }
    if (repeated > 0) {
      return { ...base, state: "check", label: `${plural(repeated, "job")} appear twice on this invoice`, detail: null };
    }
    return { ...base, state: "ok", label: "No job is on another invoice", detail: null };
  } catch (error) {
    return { ...base, state: "unknown", label: "Other invoices could not be checked", detail: failed(error) };
  }
}

export function totalsCheck(invoice: CheckableInvoice): ApprovalCheck {
  const mismatch = invoiceTotalsMismatch(invoice);
  return {
    key: "totals",
    state: mismatch ? "check" : "ok",
    enforced: false,
    label: mismatch ? "The stored total does not match the lines" : "Totals match the lines",
    detail: mismatch ? "Do not send it. Edit any line or the GST switch to recalculate, then check again." : null,
  };
}

export async function clientInvoiceApprovalChecks(
  invoice: CheckableInvoice,
  client: CheckClient = db,
): Promise<ApprovalChecks> {
  const appliesTo = invoice.status === "DRAFT" ? ("approve" as const) : null;
  const advisory = await Promise.all([ratesCheck(invoice, client), otherInvoiceCheck(invoice, client)]);
  const items: ApprovalCheck[] = [];
  if (appliesTo) {
    const xero = await xeroReservationCheck(invoice);
    // Only listed when it applies; it is otherwise noise beside the design's four.
    if (xero.state !== "ok") items.push(xero);
    items.push(await startedWorkCheck(invoice, client));
  }
  items.push(advisory[0], advisory[1], totalsCheck(invoice));
  return { appliesTo, items };
}

/** True when the checks say the approve request would be refused. */
export function approvalRefusedByChecks(checks: ApprovalChecks): boolean {
  return checks.items.some((item) => item.enforced && item.state === "refused");
}
