/**
 * MAINTENANCE THE CLIENT AGREED TO PAY FOR.
 *
 * `MaintenanceItemAssignment.payPayer` has had a CLIENT value since the day it
 * was added, and the schema comment beside it says the amount "also lands on the
 * client's invoice". Nothing ever implemented that. An admin could agree a $400
 * repair with a client, record CLIENT against it, mark the work complete, pay
 * the worker — and the client was never billed a cent. The setting existed, read
 * correctly on every screen, and moved no money.
 *
 * This module is the rule for what may be billed. It is pure so the rule can be
 * tested without a database, because the failure mode on the other side of it is
 * billing a client twice for the same repair.
 *
 * FOUR THINGS MUST ALL BE TRUE before a repair reaches an invoice:
 *
 *   1. The client agreed to pay      — payPayer is CLIENT, not COMPANY.
 *   2. The work is DONE              — completedAt is set. Billing for a repair
 *                                      that has not happened yet is the fastest
 *                                      way to lose a client's trust in every
 *                                      other line on the invoice.
 *   3. It resolves to a real amount  — via resolveAssignmentPay, the same
 *                                      function the worker's own screen uses, so
 *                                      the client is billed the figure the
 *                                      worker was shown.
 *   4. It has not been billed before — includedInClientInvoiceId is null.
 *
 * WE BILL WHAT WE PAY, exactly. No markup is applied here. If this business ever
 * wants a margin on client-funded repairs, that is a pricing decision with a
 * settings field behind it — not a number quietly multiplied inside a billing
 * helper where nobody would ever find it.
 */

import { describePay, resolveAssignmentPay } from "@/lib/maintenance/instructions";

/** The subset of an assignment row this rule needs. */
export interface BillableAssignmentInput {
  id: string;
  payType: string | null;
  payAmount: number | null;
  payHours: number | null;
  payPayer: string | null;
  completedAt: Date | null;
  includedInClientInvoiceId: string | null;
  item: {
    title: string;
    propertyId: string;
    property: { clientId: string | null } | null;
  };
}

export interface MaintenanceInvoiceLine {
  assignmentId: string;
  propertyId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  category: "MAINTENANCE";
}

/**
 * Turn the assignments for one client into invoice lines.
 *
 * `periodStart`/`periodEnd` are matched against `completedAt` — the date the
 * work was finished, which is the date a client expects to see it billed
 * against. An open-ended period (both null) takes everything outstanding, which
 * is what the first run after this ships needs to do.
 */
export function buildMaintenanceInvoiceLines(input: {
  assignments: readonly BillableAssignmentInput[];
  clientId: string;
  /** Restrict to one property, when the admin generated a per-property invoice. */
  propertyId?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}): MaintenanceInvoiceLine[] {
  const lines: MaintenanceInvoiceLine[] = [];

  for (const assignment of input.assignments) {
    if (assignment.includedInClientInvoiceId) continue;
    if (assignment.payPayer !== "CLIENT") continue;
    if (!assignment.completedAt) continue;

    // Belt and braces against the query: an assignment on somebody else's
    // property must never appear on this client's invoice, and a caller handing
    // this an unfiltered list should get nothing rather than a leak.
    if (!assignment.item.property || assignment.item.property.clientId !== input.clientId) continue;
    if (input.propertyId && assignment.item.propertyId !== input.propertyId) continue;

    const done = assignment.completedAt.getTime();
    if (input.periodStart && done < input.periodStart.getTime()) continue;
    if (input.periodEnd && done > input.periodEnd.getTime()) continue;

    const pay = resolveAssignmentPay(assignment);
    // Null means no usable figure was ever agreed — an hourly rate with no
    // hours, or nothing set at all. Billing a client zero, or a guess, is worse
    // than leaving it for somebody to notice and price properly.
    if (!pay || pay.total <= 0) continue;

    lines.push({
      assignmentId: assignment.id,
      propertyId: assignment.item.propertyId,
      // The basis is spelled out — "3 h × $45.00" — because a client querying a
      // repair charge asks how it was arrived at, and an invoice that cannot
      // answer that becomes a phone call.
      description: `Maintenance - ${assignment.item.title} (${describePay(pay)})`,
      quantity: 1,
      unitPrice: pay.total,
      lineTotal: pay.total,
      category: "MAINTENANCE",
    });
  }

  return lines;
}
