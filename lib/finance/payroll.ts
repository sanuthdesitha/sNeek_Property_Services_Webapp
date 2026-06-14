import { addDays } from "date-fns";
import { PayAdjustmentStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { computeCleanerPay } from "@/lib/finance/job-money";

export async function getPayrollSummary(input: {
  startDate: string;
  endDate: string;
  // When true (used by payroll-run creation), exclude jobs already attached to a
  // payroll run so the same job is never paid twice across overlapping runs.
  excludePaidJobs?: boolean;
}) {
  const settings = await getAppSettings();
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  const endExclusive = addDays(new Date(`${input.endDate}T00:00:00.000Z`), 1);

  const [cleaners, jobs, adjustments, shoppingRuns] = await Promise.all([
    db.user.findMany({
      where: { role: Role.CLEANER, isActive: true },
      select: { id: true, name: true, email: true, hourlyRate: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
    }),
    db.job.findMany({
      where: {
        // Bucket by completion date when set (a job finished next-day/custom date
        // counts in that period); fall back to the scheduled date otherwise.
        OR: [
          { completedAt: { gte: start, lt: endExclusive } },
          { completedAt: null, scheduledDate: { gte: start, lt: endExclusive } },
        ],
        status: { in: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] },
        // Skipped cleans are never paid out.
        cleanSkipStatus: { not: "SKIPPED" },
        ...(input.excludePaidJobs ? { payrollRunId: null } : {}),
      },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        scheduledDate: true,
        completedAt: true,
        estimatedHours: true,
        internalNotes: true,
        property: { select: { name: true, suburb: true } },
        assignments: {
          where: { removedAt: null },
          select: { userId: true, payRate: true },
        },
        timeLogs: {
          where: { stoppedAt: { not: null } },
          select: { userId: true, durationM: true },
        },
      },
      orderBy: [{ scheduledDate: "asc" }],
    }),
    db.cleanerPayAdjustment.findMany({
      where: {
        reviewedAt: { gte: start, lt: endExclusive },
        status: PayAdjustmentStatus.APPROVED,
      },
      select: {
        id: true,
        cleanerId: true,
        title: true,
        requestedAmount: true,
        approvedAmount: true,
        reviewedAt: true,
        jobId: true,
        property: { select: { name: true } },
      },
    }),
    // Shopping reimbursements: runs where cleaner paid out of pocket and is owed reimbursement
    db.shoppingRun.findMany({
      where: {
        updatedAt: { gte: start, lt: endExclusive },
        settlements: {
          some: {
            clientBillable: false,
            adminApprovedForCleanerReimbursement: true,
            includeInCleanerInvoice: false,
            // When creating a run, never re-include a reimbursement already paid.
            ...(input.excludePaidJobs ? { includedInPayrollRunId: null } : {}),
          },
        },
      },
      include: {
        settlements: {
          where: {
            adminApprovedForCleanerReimbursement: true,
            includeInCleanerInvoice: false,
            ...(input.excludePaidJobs ? { includedInPayrollRunId: null } : {}),
          },
        },
        lines: true,
      },
    }),
    // Shopping time: approved minutes * rate (stored as JSON on ShoppingRun.notes or via separate tracking)
    // For now, return empty — shopping time tracking needs a dedicated model
    Promise.resolve([] as any[]),
  ]);

  // Build shopping reimbursement map by cleaner
  const shoppingByCleaner = new Map<string, { id: string; settlementId: string; title: string; amount: number; updatedAt: Date }[]>();
  for (const run of shoppingRuns) {
    const settlement = run.settlements[0];
    if (!settlement) continue;
    if (!settlement.paidByUserId) continue;
    // Calculate reimbursement from settlements
    const amount = Number(settlement.clientBillable ? 0 : (run.lines.reduce((sum, l) => sum + Number(l.lineCost ?? 0), 0)));
    if (amount <= 0) continue;
    const list = shoppingByCleaner.get(settlement.paidByUserId) || [];
    list.push({ id: run.id, settlementId: settlement.id, title: run.title || "Shopping reimbursement", amount, updatedAt: run.updatedAt });
    shoppingByCleaner.set(settlement.paidByUserId, list);
  }

  // Shopping time tracking not yet implemented — empty map
  const shoppingTimeByCleaner = new Map<string, { id: string; minutes: number; rate: number; amount: number }[]>();

  return cleaners.map((cleaner) => {
    const jobRows = jobs.flatMap((job) => {
      const activeAssignments = job.assignments;
      const assignment = activeAssignments.find((row) => row.userId === cleaner.id);
      if (!assignment) return [];
      const splitCount = Math.max(1, activeAssignments.length);
      const timerHours = job.timeLogs
        .filter((row) => row.userId === cleaner.id)
        .reduce((sum, row) => sum + Number(row.durationM ?? 0) / 60, 0);

      // Job meta carries per-cleaner overrides (transport allowance + custom payout).
      const notes = parseJobInternalNotes(job.internalNotes as string | null);

      // Canonical cleaner-pay math (single source of truth). Approved adjustments
      // are listed separately as adjustment rows below, so they are NOT passed
      // here (would otherwise be double-counted in grossPay).
      const pay = computeCleanerPay(
        { jobType: job.jobType, estimatedHours: job.estimatedHours },
        { payRate: assignment.payRate, userHourlyRate: cleaner.hourlyRate },
        { cleanerJobHourlyRates: settings.cleanerJobHourlyRates },
        {
          cleanerId: cleaner.id,
          activeAssignmentCount: splitCount,
          timerHours,
          customPayout: notes.cleanerPayouts?.[cleaner.id],
          transportAllowance: notes.transportAllowances?.[cleaner.id],
          approvedAdjustments: 0,
        }
      );

      return [{
        id: job.id,
        jobNumber: job.jobNumber,
        propertyName: job.property.name,
        suburb: job.property.suburb,
        jobType: job.jobType,
        scheduledDate: job.completedAt ?? job.scheduledDate,
        hours: pay.hours,
        rate: pay.rate,
        rateMissing: pay.rateMissing,
        baseGross: pay.base,
        isCustomPayout: pay.source === "CUSTOM",
        transportAllowance: pay.transportAllowance,
        gross: pay.total,
      }];
    });

    const adjustmentRows = adjustments
      .filter((row) => row.cleanerId === cleaner.id)
      .map((row) => ({
        id: row.id,
        label: row.title || row.property?.name || "Approved adjustment",
        reviewedAt: row.reviewedAt,
        amount: Number(row.approvedAmount ?? row.requestedAmount ?? 0),
      }));

    const shoppingRows = (shoppingByCleaner.get(cleaner.id) || []).map((row) => ({
      id: row.id,
      settlementId: row.settlementId,
      label: row.title,
      updatedAt: row.updatedAt,
      amount: row.amount,
    }));

    const shoppingTimeRows = (shoppingTimeByCleaner.get(cleaner.id) || []).map((row) => ({
      id: row.id,
      label: `Shopping time (${row.minutes}min @ $${row.rate.toFixed(2)}/hr)`,
      amount: Number(row.amount.toFixed(2)),
    }));

    const jobGross = jobRows.reduce((sum, row) => sum + row.gross, 0);
    const adjustmentsTotal = adjustmentRows.reduce((sum, row) => sum + row.amount, 0);
    const shoppingTotal = shoppingRows.reduce((sum, row) => sum + row.amount, 0);
    const shoppingTimeTotal = shoppingTimeRows.reduce((sum, row) => sum + row.amount, 0);
    return {
      cleaner,
      jobs: jobRows,
      adjustments: adjustmentRows,
      shoppingReimbursements: shoppingRows,
      shoppingTime: shoppingTimeRows,
      totals: {
        paidHours: Number(jobRows.reduce((sum, row) => sum + row.hours, 0).toFixed(2)),
        jobGross: Number(jobGross.toFixed(2)),
        adjustments: Number(adjustmentsTotal.toFixed(2)),
        shoppingReimbursements: Number(shoppingTotal.toFixed(2)),
        shoppingTime: Number(shoppingTimeTotal.toFixed(2)),
        grossPay: Number((jobGross + adjustmentsTotal + shoppingTotal + shoppingTimeTotal).toFixed(2)),
      },
    };
  });
}

export function buildPayslipHtml(input: {
  companyName: string;
  logoUrl?: string | null;
  cleaner: { name: string | null; email: string; hourlyRate: number | null };
  rows: Array<{ jobNumber: string | null; propertyName: string; jobType: string; scheduledDate: Date; hours: number; rate: number; gross: number }>;
  adjustments: Array<{ label: string; amount: number; reviewedAt: Date | null }>;
  totals: { paidHours: number; jobGross: number; adjustments: number; grossPay: number };
  startDate: string;
  endDate: string;
}) {
  const cleanerName = input.cleaner.name?.trim() || input.cleaner.email;
  const jobRows = input.rows.map((row) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${row.jobNumber || row.propertyName}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${row.propertyName}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${row.jobType.replace(/_/g, " ")}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${row.scheduledDate.toISOString().slice(0, 10)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${row.hours.toFixed(2)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$${row.rate.toFixed(2)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$${row.gross.toFixed(2)}</td>
    </tr>
  `).join("");
  const adjustmentRows = input.adjustments.map((row) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${row.label}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${row.reviewedAt ? row.reviewedAt.toISOString().slice(0, 10) : "—"}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$${row.amount.toFixed(2)}</td>
    </tr>
  `).join("");

  return `
    <html>
      <body style="font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;padding:32px;">
        <div style="max-width:960px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ee;border-radius:24px;padding:32px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;">
            <div>
              <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#0f766e;font-weight:700;">Payslip</div>
              <h1 style="margin:10px 0 0;font-size:32px;">${input.companyName}</h1>
              <p style="margin:12px 0 0;">${cleanerName}<br/>${input.cleaner.email}</p>
              <p style="margin:12px 0 0;color:#64748b;">Period ${input.startDate} to ${input.endDate}</p>
            </div>
            ${input.logoUrl ? `<img src="${input.logoUrl}" alt="${input.companyName}" style="max-height:72px;max-width:180px;object-fit:contain;" />` : ""}
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:24px;">
            <div style="border:1px solid #e5e7eb;border-radius:18px;padding:14px;"><div style="font-size:12px;color:#64748b;">Paid hours</div><div style="font-size:24px;font-weight:700;">${input.totals.paidHours.toFixed(2)}</div></div>
            <div style="border:1px solid #e5e7eb;border-radius:18px;padding:14px;"><div style="font-size:12px;color:#64748b;">Job gross</div><div style="font-size:24px;font-weight:700;">$${input.totals.jobGross.toFixed(2)}</div></div>
            <div style="border:1px solid #e5e7eb;border-radius:18px;padding:14px;"><div style="font-size:12px;color:#64748b;">Adjustments</div><div style="font-size:24px;font-weight:700;">$${input.totals.adjustments.toFixed(2)}</div></div>
            <div style="border:1px solid #e5e7eb;border-radius:18px;padding:14px;"><div style="font-size:12px;color:#64748b;">Gross pay</div><div style="font-size:24px;font-weight:700;">$${input.totals.grossPay.toFixed(2)}</div></div>
          </div>
          <h2 style="margin-top:32px;font-size:20px;">Job lines</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="background:#f8fafc;"><th style="text-align:left;padding:10px;">Job</th><th style="text-align:left;padding:10px;">Property</th><th style="text-align:left;padding:10px;">Type</th><th style="text-align:left;padding:10px;">Date</th><th style="text-align:right;padding:10px;">Hours</th><th style="text-align:right;padding:10px;">Rate</th><th style="text-align:right;padding:10px;">Gross</th></tr></thead>
            <tbody>${jobRows || `<tr><td colspan="7" style="padding:16px;text-align:center;color:#64748b;">No completed jobs in this range.</td></tr>`}</tbody>
          </table>
          <h2 style="margin-top:32px;font-size:20px;">Approved adjustments</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="background:#f8fafc;"><th style="text-align:left;padding:10px;">Adjustment</th><th style="text-align:left;padding:10px;">Date</th><th style="text-align:right;padding:10px;">Amount</th></tr></thead>
            <tbody>${adjustmentRows || `<tr><td colspan="3" style="padding:16px;text-align:center;color:#64748b;">No approved adjustments in this range.</td></tr>`}</tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}
