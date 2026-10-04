import { format, startOfMonth } from "date-fns";
import { getOutstandingReceivables } from "./receivables";
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
    getOutstandingReceivables(),
    getPayrollSummary({ startDate: monthStart, endDate: today }),
    db.payrollRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: { grandTotal: true, periodStart: true, periodEnd: true, status: true },
    }),
  ]);

  const payrollDue = payrollRows.reduce((sum, row) => sum + row.totals.grossPay, 0);

  return {
    revenueMtd: dashboard.metrics.mtdRevenue,
    outstandingReceivables: outstandingRows.outstandingAud,
    outstandingCount: outstandingRows.outstandingCount,
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
