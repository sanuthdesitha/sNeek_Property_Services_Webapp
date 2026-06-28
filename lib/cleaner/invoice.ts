import { JobStatus, PayAdjustmentStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { computeCleanerPay } from "@/lib/finance/job-money";
import {
  listCleanerApprovedShoppingTimeRuns,
  listCleanerReimbursableShoppingRuns,
} from "@/lib/inventory/shopping-runs";

interface InvoiceOptions {
  userId: string;
  startDate?: string;
  endDate?: string;
  showSpentHours?: boolean;
  jobComments?: Record<string, string>;
  jobHourOverrides?: Record<string, number>;
  /**
   * When true, exclude jobs already attached to a payroll run (Job.payrollRunId
   * set). This is the same idempotency guard the primary payroll engine uses
   * (getPayrollSummary({ excludePaidJobs: true })) and prevents a job's pay being
   * counted by more than one run. Off by default so cleaner-facing invoices keep
   * showing every job in the period, paid or not.
   */
  excludePaidJobs?: boolean;
  /**
   * When recomputing the lines of an existing pay run, pass that run's id here so
   * jobs already stamped with THIS run are still included (only jobs paid by a
   * DIFFERENT run are excluded). Only meaningful together with excludePaidJobs.
   */
  includePaidRunId?: string;
}

export interface CleanerInvoiceData {
  cleanerName: string;
  cleanerEmail: string;
  cleanerPhone?: string;
  cleanerAddress?: string;
  cleanerAbn?: string;
  cleanerBankName?: string;
  cleanerBankBsb?: string;
  cleanerBankAccountNumber?: string;
  cleanerBankAccountName?: string;
  start: Date;
  end: Date;
  hours: number;
  estimatedPay: number;
  showSpentHours: boolean;
  rows: Array<{
    jobId: string;
    date: string;
    jobName: string;
    property: string;
    jobType: string;
    split: number;
    payBasis: "ALLOCATED" | "TIMER";
    rate: number | null;
    rateMissing: boolean;
    hours: number;
    originalHours: number;
    isHoursOverridden: boolean;
    hoursChangeNote?: string;
    spentHours: number | null;
    baseAmount: number;
    approvedExtraAmount: number;
    transportAllowance: number;
    amount: number;
    extraRequestNote?: string;
    comment?: string;
  }>;
  expenseRows: Array<{
    runId: string;
    date: string;
    runName: string;
    properties: string;
    amount: number;
    paymentMethod: string;
    note?: string;
  }>;
  expenseTotal: number;
  shoppingTimeRows: Array<{
    runId: string;
    date: string;
    runName: string;
    properties: string;
    minutes: number;
    hourlyRate: number;
    amount: number;
    note?: string;
  }>;
  shoppingTimeTotal: number;
  pendingAdjustmentCount: number;
  pendingAdjustmentAmount: number;
  companyName: string;
  logoUrl?: string;
}

function resolveDateRange(startDate?: string, endDate?: string) {
  const now = new Date();
  const start = startDate
    ? new Date(`${startDate}T00:00:00.000Z`)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = endDate ? new Date(`${endDate}T23:59:59.999Z`) : now;
  return { start, end };
}

export async function getCleanerInvoiceData(options: InvoiceOptions): Promise<CleanerInvoiceData> {
  const { start, end } = resolveDateRange(options.startDate, options.endDate);
  const showSpentHours = options.showSpentHours === true;
  const [user, settings] = await Promise.all([
    db.user.findUnique({
      where: { id: options.userId },
      select: {
        name: true,
        email: true,
        phone: true,
        address: true,
        suburb: true,
        state: true,
        postcode: true,
        abn: true,
        hourlyRate: true,
        bankBsb: true,
        bankAccountNumber: true,
        bankAccountName: true,
      },
    }),
    getAppSettings(),
  ]);

  if (!user?.email) {
    throw new Error("Cleaner account not found.");
  }

  const jobWhere: Prisma.JobWhereInput = {
    // Bucket by completion date when set (next-day/custom), else scheduled date.
    OR: [
      { completedAt: { gte: start, lte: end } },
      { completedAt: null, scheduledDate: { gte: start, lte: end } },
    ],
    status: {
      in: [JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED],
    },
    assignments: { some: { userId: options.userId } },
  };
  if (options.excludePaidJobs) {
    // Combined with AND so it coexists with the date OR above. A job counts only
    // if it isn't already attached to another payroll run; when recomputing an
    // existing run we still include that run's own previously-stamped jobs.
    jobWhere.AND = [
      options.includePaidRunId
        ? { OR: [{ payrollRunId: null }, { payrollRunId: options.includePaidRunId }] }
        : { payrollRunId: null },
    ];
  }

  const payableJobs = await db.job.findMany({
    where: jobWhere,
    include: {
      property: { select: { name: true } },
      assignments: {
        select: { userId: true, payRate: true, removedAt: true },
      },
    },
    orderBy: { scheduledDate: "asc" },
  });

  const jobIds = payableJobs.map((job) => job.id);

  const approvedAdjustments = jobIds.length
    ? await db.cleanerPayAdjustment.findMany({
        where: {
          cleanerId: options.userId,
          jobId: { in: jobIds },
          status: PayAdjustmentStatus.APPROVED,
        },
        select: {
          jobId: true,
          approvedAmount: true,
          requestedAmount: true,
          cleanerNote: true,
        },
      })
    : [];
  const pendingAdjustments = await db.cleanerPayAdjustment.findMany({
    where: {
      cleanerId: options.userId,
      status: PayAdjustmentStatus.PENDING,
      job: {
        // Match the same completedAt ?? scheduledDate window used for payable jobs.
        OR: [
          { completedAt: { gte: start, lte: end } },
          { completedAt: null, scheduledDate: { gte: start, lte: end } },
        ],
      },
    },
    select: {
      requestedAmount: true,
    },
  });

  const extrasByJob = new Map<string, number>();
  const extraNotesByJob = new Map<string, string[]>();
  for (const row of approvedAdjustments) {
    if (!row.jobId) continue;
    const amount = Number(row.approvedAmount ?? row.requestedAmount ?? 0);
    extrasByJob.set(row.jobId, (extrasByJob.get(row.jobId) ?? 0) + amount);
    const note = row.cleanerNote?.trim();
    if (note) {
      const existing = extraNotesByJob.get(row.jobId) ?? [];
      if (!existing.includes(note)) {
        existing.push(note);
      }
      extraNotesByJob.set(row.jobId, existing);
    }
  }

  const spentByJob = new Map<string, number>();
  if (jobIds.length > 0) {
    const logs = await db.timeLog.findMany({
      where: {
        userId: options.userId,
        jobId: { in: jobIds },
        stoppedAt: { not: null },
      },
      select: { jobId: true, durationM: true },
    });

    for (const log of logs) {
      const current = spentByJob.get(log.jobId) ?? 0;
      spentByJob.set(log.jobId, current + (log.durationM ?? 0) / 60);
    }
  }

  const rows = payableJobs
    .map((job) => {
      const activeAssignments = job.assignments.filter((assignment) => !assignment.removedAt);
      const splitCount = Math.max(1, activeAssignments.length);
      const cleanerAssignment =
        activeAssignments.find((assignment) => assignment.userId === options.userId) ??
        job.assignments.find((assignment) => assignment.userId === options.userId);

      if (!cleanerAssignment) return null;

      const timerHours = Math.max(0, spentByJob.get(job.id) ?? 0);
      const overrideRaw = options.jobHourOverrides?.[job.id];
      const hasOverride =
        overrideRaw != null &&
        Number.isFinite(Number(overrideRaw)) &&
        Number(overrideRaw) >= 0;
      const jobMeta = parseJobInternalNotes(job.internalNotes);
      const approvedExtraAmount = extrasByJob.get(job.id) ?? 0;
      const comment = options.jobComments?.[job.id]?.trim() || "";

      // Canonical cleaner-pay math (single source of truth) — the cleaner invoice
      // and the payroll run / finance summary never disagree on what a job pays.
      // We compute the un-overridden pay first to report originalHours, then the
      // overridden pay for the actual amounts.
      const original = computeCleanerPay(
        { jobType: job.jobType, estimatedHours: job.estimatedHours },
        { payRate: cleanerAssignment.payRate, userHourlyRate: user.hourlyRate },
        { cleanerJobHourlyRates: settings.cleanerJobHourlyRates },
        {
          cleanerId: options.userId,
          activeAssignmentCount: splitCount,
          timerHours,
          customPayout: jobMeta.cleanerPayouts?.[options.userId],
          transportAllowance: jobMeta.transportAllowances?.[options.userId],
          approvedAdjustments: approvedExtraAmount,
        }
      );
      const pay = hasOverride
        ? computeCleanerPay(
            { jobType: job.jobType, estimatedHours: job.estimatedHours },
            { payRate: cleanerAssignment.payRate, userHourlyRate: user.hourlyRate },
            { cleanerJobHourlyRates: settings.cleanerJobHourlyRates },
            {
              cleanerId: options.userId,
              activeAssignmentCount: splitCount,
              timerHours,
              customPayout: jobMeta.cleanerPayouts?.[options.userId],
              transportAllowance: jobMeta.transportAllowances?.[options.userId],
              approvedAdjustments: approvedExtraAmount,
              hoursOverride: Number(overrideRaw),
            }
          )
        : original;

      const isHoursOverridden = hasOverride && Math.abs(pay.hours - original.hours) > 0.0001;

      return {
        jobId: job.id,
        date: new Date(job.completedAt ?? job.scheduledDate).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" }),
        jobName: `${job.property.name} - ${job.jobType.replace(/_/g, " ")}`,
        property: job.property.name,
        jobType: job.jobType.replace(/_/g, " "),
        split: pay.split,
        payBasis: pay.payBasis,
        // Surface null when the rate is genuinely missing so the UI shows "Not set".
        rate: pay.rateMissing ? null : pay.rate,
        rateMissing: pay.rateMissing,
        hours: pay.hours,
        originalHours: original.hours,
        isHoursOverridden,
        hoursChangeNote: isHoursOverridden
          ? `${original.hours.toFixed(2)} -> ${pay.hours.toFixed(2)}`
          : undefined,
        spentHours: showSpentHours ? timerHours : null,
        baseAmount: pay.base,
        approvedExtraAmount: pay.adjustments,
        transportAllowance: pay.transportAllowance,
        amount: pay.total,
        extraRequestNote: (extraNotesByJob.get(job.id) ?? []).join(" | "),
        comment,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const shoppingExpenseRuns = await listCleanerReimbursableShoppingRuns({
    cleanerId: options.userId,
    start,
    end,
  });
  const shoppingTimeRuns = await listCleanerApprovedShoppingTimeRuns({
    cleanerId: options.userId,
    start,
    end,
  });
  const expenseRows = shoppingExpenseRuns.map((run) => ({
    runId: run.id,
    date: new Date(run.completedAt || run.updatedAt || run.createdAt).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" }),
    runName: run.name,
    properties: Array.from(new Set(run.rows.map((row) => row.propertyName))).join(", "),
    amount: Number(run.totals.actualTotalCost ?? 0),
    paymentMethod: run.payment.method.replace(/_/g, " "),
    note: run.reimbursementNote || run.payment.note || undefined,
  }));
  const expenseTotal = expenseRows.reduce((sum, row) => sum + row.amount, 0);
  const shoppingTimeRows = shoppingTimeRuns.map((run) => ({
    runId: run.id,
    date: new Date(run.completedAt || run.updatedAt || run.createdAt).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" }),
    runName: run.name,
    properties: Array.from(new Set(run.rows.map((row) => row.propertyName))).join(", "),
    minutes: Number(run.shoppingTime.approvedMinutes ?? 0),
    hourlyRate: Number(run.shoppingTime.approvedRate ?? 0),
    amount: Number(run.shoppingTime.approvedAmount ?? 0),
    note: run.shoppingTime.note || undefined,
  }));
  const shoppingTimeTotal = shoppingTimeRows.reduce((sum, row) => sum + row.amount, 0);

  const hours = rows.reduce((sum, row) => sum + row.hours, 0);
  const estimatedPay =
    rows.reduce((sum, row) => sum + row.amount, 0) + expenseTotal + shoppingTimeTotal;
  const pendingAdjustmentAmount = pendingAdjustments.reduce(
    (sum, row) => sum + Number(row.requestedAmount ?? 0),
    0
  );

  const addressParts = [user.address, user.suburb, user.state, user.postcode]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);

  return {
    cleanerName: user.name ?? user.email,
    cleanerEmail: user.email,
    cleanerPhone: user.phone ?? undefined,
    cleanerAddress: addressParts.length ? addressParts.join(", ") : undefined,
    cleanerAbn: user.abn ?? undefined,
    cleanerBankBsb: user.bankBsb ?? undefined,
    cleanerBankAccountNumber: user.bankAccountNumber ?? undefined,
    cleanerBankAccountName: user.bankAccountName ?? undefined,
    start,
    end,
    hours,
    estimatedPay,
    showSpentHours,
    rows,
    expenseRows,
    expenseTotal,
    shoppingTimeRows,
    shoppingTimeTotal,
    pendingAdjustmentCount: pendingAdjustments.length,
    pendingAdjustmentAmount,
    companyName: settings.companyName,
    logoUrl: settings.reportLogoUrl || settings.logoUrl,
  };
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

export function buildCleanerInvoiceHtml(data: CleanerInvoiceData) {
  const includeTransportColumn = data.rows.some((row) => row.transportAllowance > 0);
  const includeHoursChangeColumn = data.rows.some((row) => row.isHoursOverridden);
  const changedRowsCount = data.rows.filter((row) => row.isHoursOverridden).length;
  const includeCommentColumn = data.rows.some((row) =>
    Boolean((row.comment && row.comment.trim()) || (row.extraRequestNote && row.extraRequestNote.trim()))
  );
  const expenseRowsHtml = data.expenseRows
    .map(
      (row) => `
        <tr>
          <td class="cell">${row.date}</td>
          <td class="cell">${escapeHtml(row.runName)}</td>
          <td class="cell">${escapeHtml(row.properties)}</td>
          <td class="cell">${escapeHtml(row.paymentMethod)}</td>
          <td class="cell right">${formatCurrency(row.amount)}</td>
          <td class="cell">${row.note ? escapeHtml(row.note) : "-"}</td>
        </tr>
      `
    )
    .join("");
  const shoppingTimeRowsHtml = data.shoppingTimeRows
    .map(
      (row) => `
        <tr>
          <td class="cell">${row.date}</td>
          <td class="cell">${escapeHtml(row.runName)}</td>
          <td class="cell">${escapeHtml(row.properties)}</td>
          <td class="cell right">${row.minutes}</td>
          <td class="cell right">${formatCurrency(row.hourlyRate)}</td>
          <td class="cell right">${formatCurrency(row.amount)}</td>
          <td class="cell">${row.note ? escapeHtml(row.note) : "-"}</td>
        </tr>
      `
    )
    .join("");
  const logoHtml = data.logoUrl
    ? `<img class="logo" src="${escapeHtml(data.logoUrl)}" alt="${escapeHtml(data.companyName)} logo" />`
    : "";

  const cleanerLines = [
    data.cleanerAddress ? `<p>${escapeHtml(data.cleanerAddress)}</p>` : "",
    data.cleanerPhone ? `<p>Mobile: ${escapeHtml(data.cleanerPhone)}</p>` : "",
    `<p>Email: ${escapeHtml(data.cleanerEmail)}</p>`,
    data.cleanerAbn ? `<p>ABN: ${escapeHtml(data.cleanerAbn)}</p>` : "",
  ]
    .filter(Boolean)
    .join("");

  const bankLines = [
    data.cleanerBankAccountName ? `<p>Account name: ${escapeHtml(data.cleanerBankAccountName)}</p>` : "",
    data.cleanerBankBsb ? `<p>BSB: ${escapeHtml(data.cleanerBankBsb)}</p>` : "",
    data.cleanerBankAccountNumber ? `<p>Account number: ${escapeHtml(data.cleanerBankAccountNumber)}</p>` : "",
  ]
    .filter(Boolean)
    .join("");

  const partiesHtml = `
        <div class="parties">
          <div class="party">
            <h2>From (Cleaner)</h2>
            <p><strong>${escapeHtml(data.cleanerName)}</strong></p>
            ${cleanerLines}
          </div>
          <div class="party">
            <h2>Payment details</h2>
            ${bankLines || '<p style="color:#b91c1c;">No bank details on file</p>'}
          </div>
        </div>`;

  const rowsHtml = data.rows
    .map(
      (row) => {
        const comments: string[] = [];
        if (row.extraRequestNote?.trim()) {
          comments.push(`<div><strong>Extra request:</strong> ${escapeHtml(row.extraRequestNote)}</div>`);
        }
        if (row.comment?.trim()) {
          comments.push(`<div><strong>Cleaner comment:</strong> ${escapeHtml(row.comment)}</div>`);
        }
        const commentCell = comments.length > 0 ? comments.join("") : "-";
        return `
        <tr${row.isHoursOverridden ? ` class="changed-row"` : ""}>
          <td class="cell">${row.date}</td>
          <td class="cell">${escapeHtml(row.property)}</td>
          <td class="cell">${escapeHtml(row.jobType)}</td>
          <td class="cell right">${row.split}</td>
          <td class="cell right">${row.rate != null ? `${formatCurrency(row.rate)}${row.rateMissing ? " (default)" : ""}` : "Not set"}</td>
          <td class="cell right">${row.hours.toFixed(2)}</td>
          ${includeHoursChangeColumn ? `<td class="cell">${row.hoursChangeNote ? escapeHtml(row.hoursChangeNote) : "-"}</td>` : ""}
          ${data.showSpentHours ? `<td class="cell right">${(row.spentHours ?? 0).toFixed(2)}</td>` : ""}
          <td class="cell right">${formatCurrency(row.baseAmount)}</td>
          <td class="cell right">${formatCurrency(row.approvedExtraAmount)}</td>
          ${includeTransportColumn ? `<td class="cell right">${formatCurrency(row.transportAllowance)}</td>` : ""}
          <td class="cell right">${formatCurrency(row.amount)}</td>
          ${includeCommentColumn ? `<td class="cell">${commentCell}</td>` : ""}
        </tr>
      `;
      }
    )
    .join("");

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Cleaner Invoice</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111; margin: 24px; }
          .header { display: flex; justify-content: space-between; margin-bottom: 18px; gap: 12px; }
          .brand { display: flex; gap: 12px; align-items: center; }
          .logo { max-width: 180px; max-height: 64px; width: auto; height: auto; object-fit: contain; }
          .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0; }
          .party { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
          .party h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; margin: 0 0 6px; }
          .party p { margin: 2px 0; font-size: 12px; color: #222; }
          .title { font-size: 24px; margin: 0; }
          .sub { color: #555; margin: 2px 0; font-size: 12px; }
          .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0; }
          .box { border: 1px solid #ddd; border-radius: 8px; padding: 10px; }
          .label { color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
          .value { font-weight: bold; font-size: 16px; margin-top: 4px; }
          .rule { margin-top: 10px; font-size: 11px; color: #666; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th { text-align: left; border-bottom: 2px solid #ddd; padding: 8px; font-size: 12px; }
          .cell { border-bottom: 1px solid #eee; padding: 8px; font-size: 12px; vertical-align: top; }
          .right { text-align: right; white-space: nowrap; }
          .empty { border: 1px dashed #ddd; border-radius: 8px; padding: 16px; margin-top: 12px; color: #666; }
          .changed-row { background: #fffbeb; }
          .changed-note { margin-top: 8px; font-size: 11px; color: #92400e; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="brand">
            ${logoHtml}
            <div>
              <h1 class="title">${escapeHtml(data.companyName)} Cleaner Invoice</h1>
              <p class="sub"><strong>Cleaner:</strong> ${escapeHtml(data.cleanerName)} (${escapeHtml(data.cleanerEmail)})</p>
              <p class="sub"><strong>Period:</strong> ${data.start.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" })} to ${data.end.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" })}</p>
            </div>
          </div>
          <div>
            <p class="sub"><strong>Generated:</strong> ${new Date().toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}</p>
          </div>
        </div>
        ${partiesHtml}

        <div class="summary">
          <div class="box">
            <div class="label">Paid Hours</div>
            <div class="value">${data.hours.toFixed(2)}</div>
          </div>
          <div class="box">
            <div class="label">Estimated Pay</div>
            <div class="value">${formatCurrency(data.estimatedPay)}</div>
          </div>
          <div class="box">
            <div class="label">Shopping Reimbursements</div>
            <div class="value">${formatCurrency(data.expenseTotal)}</div>
          </div>
          <div class="box">
            <div class="label">Shopping Time</div>
            <div class="value">${formatCurrency(data.shoppingTimeTotal)}</div>
          </div>
          <div class="box">
            <div class="label">Payable Jobs</div>
            <div class="value">${data.rows.length}</div>
          </div>
          <div class="box">
            <div class="label">Invoice Type</div>
            <div class="value">Contractor</div>
          </div>
        </div>

        <p class="rule">Pay rule: fixed/allocated hours are paid in full and split equally across assigned cleaners. If fixed hours are not set, pay uses the cleaner's clocked timer. Approved extras are added per job.</p>
        ${changedRowsCount > 0 ? `<p class="changed-note">Hours overridden on ${changedRowsCount} row(s). Changed rows are highlighted.</p>` : ""}

        ${
          data.expenseRows.length > 0
            ? `
              <h2 style="margin-top:20px;font-size:16px;">Shopping reimbursements</h2>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Run</th>
                    <th>Properties</th>
                    <th>Paid By</th>
                    <th class="right">Amount</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>${expenseRowsHtml}</tbody>
              </table>
            `
            : ""
        }

        ${
          data.shoppingTimeRows.length > 0
            ? `
              <h2 style="margin-top:20px;font-size:16px;">Shopping time</h2>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Run</th>
                    <th>Properties</th>
                    <th class="right">Minutes</th>
                    <th class="right">Rate</th>
                    <th class="right">Amount</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>${shoppingTimeRowsHtml}</tbody>
              </table>
            `
            : ""
        }

        ${
          data.rows.length > 0
            ? `
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Property</th>
                    <th>Job Type</th>
                    <th class="right">Split</th>
                    <th class="right">Rate</th>
                    <th class="right">Paid Hours</th>
                    ${includeHoursChangeColumn ? `<th>Hours Changed</th>` : ""}
                    ${data.showSpentHours ? `<th class="right">Hours Spent</th>` : ""}
                    <th class="right">Base</th>
                    <th class="right">Approved Extras</th>
                    ${includeTransportColumn ? `<th class="right">Transport</th>` : ""}
                    <th class="right">Total</th>
                    ${includeCommentColumn ? `<th>Comment</th>` : ""}
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
              </table>
            `
            : `<div class="empty">No payable jobs found in this date range.</div>`
        }
      </body>
    </html>
  `;
}

export async function renderCleanerInvoicePdf(html: string): Promise<Buffer> {
  const { renderPdfFromHtml } = await import("@/lib/reports/pdf");
  return renderPdfFromHtml(html, "cleaner invoice PDF generation", {
    margin: { top: "16mm", right: "10mm", bottom: "16mm", left: "10mm" },
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
