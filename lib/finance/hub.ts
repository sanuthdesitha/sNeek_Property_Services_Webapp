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
 *  - outstandingCount /  → sum of ClientInvoice.totalAmount where status = SENT
 *    outstandingReceivables  (invoiced to the client, not yet marked paid)
 *  - payrollDue          → getPayrollSummary() gross pay for the current month
 *                          (the same engine the Payroll runs use)
 *  - lastRunTotal        → grandTotal of the most recent PayrollRun (or null)
 */
export async function getFinanceHubSummary(now = new Date()) {
  const monthStart = format(startOfMonth(now), "yyyy-MM-dd");
  const today = format(now, "yyyy-MM-dd");

  const [dashboard, outstandingAgg, payrollRows, lastRun] = await Promise.all([
    getFinanceDashboardData(now),
    db.clientInvoice.aggregate({
      where: { status: ClientInvoiceStatus.SENT },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    getPayrollSummary({ startDate: monthStart, endDate: today }),
    db.payrollRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: { grandTotal: true, periodStart: true, periodEnd: true, status: true },
    }),
  ]);

  const payrollDue = payrollRows.reduce((sum, row) => sum + row.totals.grossPay, 0);

  return {
    revenueMtd: dashboard.metrics.mtdRevenue,
    outstandingReceivables: Number(outstandingAgg._sum.totalAmount ?? 0),
    outstandingCount: outstandingAgg._count._all,
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
