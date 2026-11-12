/**
 * The three "Before you approve" checks that became server rules in Wave D
 * (owner-approved rule change). A DRAFT is not approved, sent or marked paid
 * while:
 *   (a) a job line's job resolves no client rate now, or a line's amount is
 *       not a real number;
 *   (b) a job on it is also on another live invoice, or twice on this one;
 *   (c) its stored total does not match its lines;
 * or while any of those cannot be checked. (d), the started-work review, was
 * already enforced (assertStartedWorkReviewed).
 *
 * The refusal text is built from the same check items the editor shows, so the
 * screen, the PATCH, the send route and bulk approve all state the same
 * reason. It runs under the client's billing advisory lock (the generator's
 * lock), so a draft cannot be approved while another request is billing the
 * same work. Invoices already APPROVED, SENT or later are not affected.
 */
import type { Prisma } from "@prisma/client";
import { otherInvoiceCheck, ratesCheck, totalsCheck, type CheckableInvoice } from "./client-invoice-checks";
import type { ApprovalCheck } from "./client-invoice-editor-types";

type RuleClient = Pick<Prisma.TransactionClient, "job" | "propertyClientRate" | "priceBook" | "clientInvoiceLine" | "$queryRaw" | "$executeRaw">;

/** Statuses that issue a draft: approval, sending and payment all pass these rules. */
export const ISSUING_STATUSES: ReadonlySet<string> = new Set(["APPROVED", "SENT", "PAID", "PART_PAID"]);

/** Whether a request moves this invoice out of DRAFT into an issued state. */
export function leavesDraft(currentStatus: string, nextStatus: string | null | undefined, recordsPayment: boolean): boolean {
  if (currentStatus !== "DRAFT") return false;
  return recordsPayment || (Boolean(nextStatus) && ISSUING_STATUSES.has(nextStatus!));
}

export function checkRefusalText(item: ApprovalCheck): string {
  return `${item.label}${item.detail ? ` (${item.detail})` : ""}.`;
}

/** The blocking items, in the checklist's order. Empty when approval may proceed. */
export async function approvalBlockers(invoice: CheckableInvoice, client: RuleClient): Promise<ApprovalCheck[]> {
  const mode = { enforce: true };
  const checkClient = client as unknown as Parameters<typeof ratesCheck>[1];
  const items = [
    await ratesCheck(invoice, checkClient, mode),
    await otherInvoiceCheck(invoice, checkClient, mode),
    totalsCheck(invoice, mode),
  ];
  return items.filter((item) => item.state === "refused" || item.state === "unknown");
}

/**
 * Take the client's billing lock and run the rules. Returns the refusal
 * message, or null. Call inside the transaction that changes the status.
 */
export async function approvalRuleRefusal(invoice: CheckableInvoice, client: RuleClient): Promise<string | null> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`client-invoice:${invoice.clientId}`}))`;
  const blockers = await approvalBlockers(invoice, client);
  if (blockers.length === 0) return null;
  return `Not approved: ${blockers.map(checkRefusalText).join(" ")}`;
}
