import { format, startOfMonth } from "date-fns";
import { ClientInvoiceStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getFinanceDashboardData } from "@/lib/finance/dashboard";
import { getPayrollSummary } from "@/lib/finance/payroll";

/**
 * KPI strip metrics for the Finance hub header. Every value is derived from the
 * same queries the individual tabs already use — nothing is fabricated:
 *
 *  - revenueMtd          → getFinanceDashboardData().metrics.mtdRevenue
 *                          (paid invoice revenue, month-to-date)
 *  - outstandingCount /  → what is still owed across SENT and PART_PAID
 *    outstandingReceivables  invoices: each one's total minus whatever has
 *                            already been received against it
 *  - payrollDue          → getPayrollSummary() gross pay for the current month
 *                          (the same engine the Payroll runs use)
 *  - lastRunTotal        → grandTotal of the most recent PayrollRun (or null)
 */
export async function getFinanceHubSummary(now = new Date()) {
  const monthStart = format(startOfMonth(now), "yyyy-MM-dd");
  const today = format(now, "yyyy-MM-dd");

  const [dashboard, outstandingRows, payrollRows, lastRun] = await Promise.all([
    getFinanceDashboardData(now),
    // PART_PAID belongs here as much as SENT. It was excluded, so the moment a
    // client paid ANY part of an invoice the whole balance dropped out of
    // receivables — a $4,000 invoice with $200 against it took $4,000 off the
    // figure and left $3,800 owed that the strip said nothing about. Money got
    // quieter the closer it came to being collected.
    //
    // Rows rather than an aggregate, because what is outstanding on a part-paid
    // invoice is its total MINUS what has come in, and a _sum of totalAmount
    // cannot express that subtraction.
    db.clientInvoice.findMany({
      where: {
        status: { in: [ClientInvoiceStatus.SENT, ClientInvoiceStatus.PART_PAID] },
      },
      select: { totalAmount: true, paidAmount: true },
    }),
    getPayrollSummary({ startDate: monthStart, endDate: today }),
    db.payrollRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: { grandTotal: true, periodStart: true, periodEnd: true, status: true },
    }),
  ]);

  const payrollDue = payrollRows.reduce((sum, row) => sum + row.totals.grossPay, 0);

  // Clamped at zero per invoice: an overpayment on one must not silently cancel
  // out what is genuinely owed on another and make the total read lower than
  // the debt actually is.
  const outstandingReceivables = outstandingRows.reduce(
    (sum, row) => sum + Math.max(0, Number(row.totalAmount ?? 0) - Number(row.paidAmount ?? 0)),
    0
  );

  return {
    revenueMtd: dashboard.metrics.mtdRevenue,
    outstandingReceivables: Number(outstandingReceivables.toFixed(2)),
    outstandingCount: outstandingRows.length,
    payrollDue: Number(payrollDue.toFixed(2)),
    lastRun: lastRun
      ? {
          grandTotal: Number(lastRun.grandTotal ?? 0),
          periodStart: lastRun.periodStart,
          periodEnd: lastRun.periodEnd,
          status: lastRun.status,
        }
      : null,
  };
}
