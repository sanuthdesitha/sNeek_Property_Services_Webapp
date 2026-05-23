import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getCleanerInvoiceData } from "@/lib/cleaner/invoice";

export async function getPayrollSummary(input: { startDate: string; endDate: string }) {
  const cleaners = await db.user.findMany({
    where: { role: Role.CLEANER, isActive: true },
    select: { id: true, name: true, email: true, hourlyRate: true },
    orderBy: [{ name: "asc" }, { email: "asc" }],
  });

  const summaries = await Promise.all(
    cleaners.map(async (cleaner) => {
      const invoice = await getCleanerInvoiceData({
        userId: cleaner.id,
        startDate: input.startDate,
        endDate: input.endDate,
        showSpentHours: true,
      });
      const jobRows = invoice.rows.map((row) => ({
        id: row.jobId,
        jobNumber: row.jobNumber,
        propertyName: row.property,
        suburb: "",
        jobType: row.jobType,
        scheduledDate: new Date(row.date.split("/").reverse().join("-")),
        hours: Number(row.hours.toFixed(2)),
        spentHours: row.spentHours,
        originalHours: row.originalHours,
        payBasis: row.payBasis,
        split: row.split,
        rate: row.rate,
        baseGross: Number(row.baseAmount.toFixed(2)),
        approvedExtraAmount: Number(row.approvedExtraAmount.toFixed(2)),
        transportAllowance: Number(row.transportAllowance.toFixed(2)),
        gross: Number(row.amount.toFixed(2)),
      }));
      const shoppingRows = invoice.expenseRows.map((row) => ({
        id: row.runId,
        label: row.runName,
        updatedAt: new Date(row.date.split("/").reverse().join("-")),
        amount: Number(row.amount.toFixed(2)),
      }));
      const shoppingTimeRows = invoice.shoppingTimeRows.map((row) => ({
        id: row.runId,
        label: `${row.runName} (${row.minutes}min @ $${row.hourlyRate.toFixed(2)}/hr)`,
        amount: Number(row.amount.toFixed(2)),
      }));

      return {
        cleaner,
        jobs: jobRows,
        adjustments: [] as Array<{ id: string; label: string; reviewedAt: Date | null; amount: number }>,
        shoppingReimbursements: shoppingRows,
        shoppingTime: shoppingTimeRows,
        totals: {
          paidHours: Number(invoice.hours.toFixed(2)),
          jobGross: Number(jobRows.reduce((sum, row) => sum + row.baseGross + row.approvedExtraAmount, 0).toFixed(2)),
          adjustments: 0,
          shoppingReimbursements: Number(invoice.expenseTotal.toFixed(2)),
          shoppingTime: Number(invoice.shoppingTimeTotal.toFixed(2)),
          grossPay: Number(invoice.estimatedPay.toFixed(2)),
        },
      };
    })
  );

  return summaries;
}

export function buildPayslipHtml(input: {
  companyName: string;
  logoUrl?: string | null;
  cleaner: { name: string | null; email: string; hourlyRate: number | null };
  rows: Array<{ jobNumber: string | null; propertyName: string; jobType: string; scheduledDate: Date; hours: number; rate: number | null; gross: number }>;
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
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">${row.rate == null ? "Not set" : `$${row.rate.toFixed(2)}`}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;">$${row.gross.toFixed(2)}</td>
    </tr>
  `).join("");

  return `
    <html><body style="font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;padding:32px;">
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
      </div>
    </body></html>
  `;
}
