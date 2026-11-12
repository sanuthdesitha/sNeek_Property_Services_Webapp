/**
 * "Before you approve": the checks shown beside a draft, computed on the server
 * from the same functions the approve request runs, so the list can never say
 * OK where approval would be refused.
 *
 * Enforced by the approve PATCH (client-invoice-patch.ts) on a DRAFT:
 *   - a pending or failed Xero export reservation (isXeroExportPending)
 *   - the started-work review (startedWorkRefusal, read without the job locks)
 *   - at least one line (emptyInvoiceRefusal: a blank draft cannot be approved)
 *   - on a credit note, the credit limit (creditNoteTotalRefusal)
 *   - since Wave D (owner-approved rule change; client-invoice-approval-rules.ts):
 *     every job line's job resolves a client rate and every line amount is a
 *     real number (missing-rates.ts, the generator's rule); no job is on
 *     another live invoice or twice on this one (the generator's
 *     double-billing rule); the stored total matches the lines
 *     (invoiceTotalsMismatch).
 * Past approval the last three are shown as "Check" only: an invoice already
 * approved or sent is not retroactively refused anything.
 * A check that cannot be read is "unknown", never OK, and blocks approval.
 */
import { db } from "@/lib/db";
import { LIVE_INVOICE_WHERE } from "@/lib/invoicing/invoiced-job-rule";
import { invoiceTotalsMismatch } from "./invoice-totals-check";
import { missingRateReports } from "./missing-rates";
import { emptyInvoiceRefusal, isXeroExportPending } from "./client-invoice-guards";
import { creditNoteTotalRefusal, creditableRemaining } from "./client-invoice-adjustments";
import { creditedAmountOf } from "@/lib/finance/receivables";
import { startedWorkRefusal } from "./started-work-reconciliation";
import type { ApprovalCheck, ApprovalChecks } from "./client-invoice-editor-types";

export type CheckableInvoice = {
  id: string;
  invoiceNumber?: string;
  status: string;
  kind?: string | null;
  creditsInvoiceId?: string | null;
  clientId: string;
  metadata: unknown;
  gstEnabled: boolean | null;
  totalAmount: number;
  lines: Array<{ id: string; jobId: string | null; quantity: number; unitPrice: number; lineTotal: number; category: string }>;
};

type CheckClient = Pick<typeof db, "job" | "propertyClientRate" | "priceBook" | "clientInvoiceLine" | "$queryRaw"> &
  Partial<Pick<typeof db, "clientInvoice">>;

function failed(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The check could not be completed.";
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** On a draft the three Wave D checks block approval; past approval they are advice. */
export type CheckMode = { enforce: boolean };

function failingState(mode: CheckMode): "refused" | "check" {
  return mode.enforce ? "refused" : "check";
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

export async function ratesCheck(invoice: CheckableInvoice, client: CheckClient, mode: CheckMode = { enforce: false }): Promise<ApprovalCheck> {
  const ids = jobIdsOf(invoice);
  const base = { key: "rates" as const, enforced: mode.enforce, fixHref: `/v2/admin/clients/${encodeURIComponent(invoice.clientId)}`, fixLabel: "Set rates" };
  const unreadable = invoice.lines.filter((line) => ![line.quantity, line.unitPrice, line.lineTotal].every((value) => Number.isFinite(Number(value))));
  if (unreadable.length > 0) {
    return { ...base, state: failingState(mode), label: `${plural(unreadable.length, "line")} have an amount that could not be determined`, detail: "Edit or remove the marked lines.", fixHref: null, fixLabel: null };
  }
  if (ids.length === 0) return { ...base, state: "ok", label: "No job lines to rate", detail: null, fixHref: null, fixLabel: null };
  try {
    const report = (await missingRateReports([{ id: invoice.id, clientId: invoice.clientId, jobIds: ids }], client)).get(invoice.id)!;
    if (report.missingJobIds.length > 0) {
      return { ...base, state: "unknown", label: `${plural(report.missingJobIds.length, "job")} on this invoice could not be found`, detail: null, fixHref: null, fixLabel: null };
    }
    if (report.unrated.length > 0) {
      const names = report.unrated.map((job) => job.jobNumber ?? job.id).join(", ");
      return { ...base, state: failingState(mode), label: `${plural(report.unrated.length, "job")} now have no client rate`, detail: names };
    }
    return { ...base, state: "ok", label: `All ${plural(ids.length, "job")} have a client rate`, detail: null, fixHref: null, fixLabel: null };
  } catch (error) {
    return { ...base, state: "unknown", label: "Rates could not be checked", detail: failed(error), fixHref: null, fixLabel: null };
  }
}

export async function otherInvoiceCheck(invoice: CheckableInvoice, client: CheckClient, mode: CheckMode = { enforce: false }): Promise<ApprovalCheck> {
  const ids = jobIdsOf(invoice);
  const base = { key: "other-invoice" as const, enforced: mode.enforce, fixHref: null, fixLabel: null };
  const repeated = invoice.lines.filter((line) => line.jobId).length - ids.length;
  if (ids.length === 0) return { ...base, state: "ok", label: "No job lines on this invoice", detail: null };
  try {
    // Any live invoice, whoever it bills (the one invoiced rule).
    const elsewhere = await client.clientInvoiceLine.findMany({
      where: { jobId: { in: ids }, invoiceId: { not: invoice.id }, invoice: LIVE_INVOICE_WHERE },
      select: { jobId: true, invoice: { select: { id: true, invoiceNumber: true } } },
    });
    if (elsewhere.length > 0) {
      const numbers = Array.from(new Set(elsewhere.map((line) => line.invoice.invoiceNumber))).join(", ");
      const jobs = new Set(elsewhere.map((line) => line.jobId)).size;
      const first = elsewhere[0]?.invoice.id;
      return {
        ...base,
        state: failingState(mode),
        label: `${plural(jobs, "job")} also on another invoice`,
        detail: numbers,
        fixHref: first ? `/v2/admin/finance/invoices/${encodeURIComponent(first)}` : null,
        fixLabel: first ? "Open the other invoice" : null,
      };
    }
    if (repeated > 0) {
      return { ...base, state: failingState(mode), label: `${plural(repeated, "job")} appear twice on this invoice`, detail: "Remove the repeated line." };
    }
    return { ...base, state: "ok", label: "No job is on another invoice", detail: null };
  } catch (error) {
    return { ...base, state: "unknown", label: "Other invoices could not be checked", detail: failed(error) };
  }
}

export function linesCheck(invoice: CheckableInvoice): ApprovalCheck {
  const refusal = emptyInvoiceRefusal(invoice);
  return {
    key: "lines",
    state: refusal ? "refused" : "ok",
    enforced: true,
    label: refusal ? "This invoice has no lines" : "The invoice has lines",
    detail: refusal,
  };
}

/** A credit note may not credit more than its invoice has left (read without the lock). */
export async function creditLimitCheck(invoice: CheckableInvoice, client: CheckClient): Promise<ApprovalCheck> {
  const base = { key: "credit-limit" as const, enforced: true };
  try {
    const original = invoice.creditsInvoiceId && client.clientInvoice
      ? await client.clientInvoice.findUnique({
          where: { id: invoice.creditsInvoiceId },
          select: {
            invoiceNumber: true,
            totalAmount: true,
            creditNotes: { where: { id: { not: invoice.id } }, select: { status: true, totalAmount: true } },
          },
        })
      : null;
    if (!original) return { ...base, state: "unknown", label: "The credited invoice could not be read", detail: null };
    const remaining = creditableRemaining(original.totalAmount, creditedAmountOf(original.creditNotes));
    const refusal = creditNoteTotalRefusal({
      total: invoice.totalAmount,
      remaining,
      originalNumber: original.invoiceNumber,
      requireCredit: true,
    });
    if (refusal) return { ...base, state: "refused", label: "The credit is not within the limit", detail: refusal };
    return { ...base, state: "ok", label: `Within what ${original.invoiceNumber} has left to credit ($${remaining.toFixed(2)})`, detail: null };
  } catch (error) {
    return { ...base, state: "unknown", label: "The credit limit could not be checked", detail: failed(error) };
  }
}

export function totalsCheck(invoice: CheckableInvoice, mode: CheckMode = { enforce: false }): ApprovalCheck {
  const mismatch = invoiceTotalsMismatch(invoice);
  return {
    key: "totals",
    state: mismatch ? failingState(mode) : "ok",
    enforced: mode.enforce,
    label: mismatch ? "The stored total does not match the lines" : "Totals match the lines",
    detail: mismatch ? "Do not send it. Edit any line or the GST switch to recalculate, then check again." : null,
  };
}

export async function clientInvoiceApprovalChecks(
  invoice: CheckableInvoice,
  client: CheckClient = db,
): Promise<ApprovalChecks> {
  const appliesTo = invoice.status === "DRAFT" ? ("approve" as const) : null;
  const mode = { enforce: appliesTo === "approve" };
  const advisory = await Promise.all([ratesCheck(invoice, client, mode), otherInvoiceCheck(invoice, client, mode)]);
  const items: ApprovalCheck[] = [];
  if (appliesTo) {
    const xero = await xeroReservationCheck(invoice);
    // Only listed when it applies; it is otherwise noise beside the design's four.
    if (xero.state !== "ok") items.push(xero);
    const lines = linesCheck(invoice);
    if (lines.state !== "ok") items.push(lines);
    if (invoice.kind === "CREDIT_NOTE") items.push(await creditLimitCheck(invoice, client));
    items.push(await startedWorkCheck(invoice, client));
  }
  items.push(advisory[0], advisory[1], totalsCheck(invoice, mode));
  return { appliesTo, items };
}

/** True when the checks say the approve request would be refused (an enforced check that failed or could not be read). */
export function approvalRefusedByChecks(checks: ApprovalChecks): boolean {
  return checks.items.some((item) => item.enforced && (item.state === "refused" || item.state === "unknown"));
}
