import { addDays } from "date-fns";
import { PayAdjustmentStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

export async function getPayrollSummary(input: { startDate: string; endDate: string }) {
  const settings = await getAppSettings();
  const start = new Date(`${input.startDate}T00:00:00.000Z`);
  const endExclusive = addDays(new Date(`${input.endDate}T00:00:00.000Z`), 1);

  const [cleaners, jobs, adjustments] = await Promise.all([
    db.user.findMany({
      where: { role: Role.CLEANER, isActive: true },
      select: { id: true, name: true, email: true, hourlyRate: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
    }),
    db.job.findMany({
      where: {
        scheduledDate: { gte: start, lt: endExclusive },
        status: { in: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] },
      },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        scheduledDate: true,
        estimatedHours: true,
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
        requestedAt: { gte: start, lt: endExclusive },
        status: PayAdjustmentStatus.APPROVED,
      },
      select: {
        id: true,
        cleanerId: true,
        title: true,
        requestedAmount: true,
        approvedAmount: true,
        requestedAt: true,
        jobId: true,
        property: { select: { name: true } },
      },
    }),
  ]);

  return cleaners.map((cleaner) => {
    const jobRows = jobs.flatMap((job) => {
      const activeAssignments = job.assignments;
      const assignment = activeAssignments.find((row) => row.userId === cleaner.id);
      if (!assignment) return [];
      const splitCount = Math.max(1, activeAssignments.length);
      const timerHours = job.timeLogs
        .filter((row) => row.userId === cleaner.id)
        .reduce((sum, row) => sum + Number(row.durationM ?? 0) / 60, 0);
      const allocatedHours = Number(job.estimatedHours ?? 0);
      const paidHours = allocatedHours > 0 ? allocatedHours / splitCount : timerHours;
      const rate = Number(assignment.payRate ?? cleaner.hourlyRate ?? settings.cleanerJobHourlyRates?.[cleaner.id]?.[job.jobType] ?? 40);
      const gross = Number((paidHours * rate).toFixed(2));
      return [{
        id: job.id,
        jobNumber: job.jobNumber,
        propertyName: job.property.name,
        suburb: job.property.suburb,
        jobType: job.jobType,
        scheduledDate: job.scheduledDate,
        hours: Number(paidHours.toFixed(2)),
        rate,
        gross,
      }];
    });

    const adjustmentRows = adjustments
      .filter((row) => row.cleanerId === cleaner.id)
      .map((row) => ({
        id: row.id,
        label: row.title || row.property?.name || "Approved adjustment",
        requestedAt: row.requestedAt,
        amount: Number(row.approvedAmount ?? row.requestedAmount ?? 0),
      }));

    const jobGross = jobRows.reduce((sum, row) => sum + row.gross, 0);
    const adjustmentsTotal = adjustmentRows.reduce((sum, row) => sum + row.amount, 0);
    return {
      cleaner,
      jobs: jobRows,
      adjustments: adjustmentRows,
      totals: {
        paidHours: Number(jobRows.reduce((sum, row) => sum + row.hours, 0).toFixed(2)),
        jobGross: Number(jobGross.toFixed(2)),
        adjustments: Number(adjustmentsTotal.toFixed(2)),
        grossPay: Number((jobGross + adjustmentsTotal).toFixed(2)),
      },
    };
  });
}

export function buildPayslipHtml(input: {
  companyName: string;
  logoUrl?: string | null;
  cleaner: { name: string | null; email: string; hourlyRate: number | null };
  rows: Array<{ jobNumber: string | null; propertyName: string; jobType: string; scheduledDate: Date; hours: number; rate: number; gross: number }>;
  adjustments: Array<{ label: string; amount: number; requestedAt: Date }>;
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
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;">${row.requestedAt.toISOString().slice(0, 10)}</td>
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
