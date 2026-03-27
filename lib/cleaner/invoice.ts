import { JobStatus, PayAdjustmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
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
}

export interface CleanerInvoiceData {
  cleanerName: string;
  cleanerEmail: string;
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
      select: { name: true, email: true },
    }),
    getAppSettings(),
  ]);

  if (!user?.email) {
    throw new Error("Cleaner account not found.");
  }

  const payableJobs = await db.job.findMany({
    where: {
      scheduledDate: { gte: start, lte: end },
      status: {
        in: [JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED],
      },
      assignments: { some: { userId: options.userId } },
    },
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
        scheduledDate: { gte: start, lte: end },
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
      const allocatedHours = Number(job.estimatedHours ?? 0);
      const hasAllocatedHours = Number.isFinite(allocatedHours) && allocatedHours > 0;
      const payBasis: "ALLOCATED" | "TIMER" = hasAllocatedHours ? "ALLOCATED" : "TIMER";
      const originalPaidHours = hasAllocatedHours ? allocatedHours / splitCount : timerHours;
      const overrideRaw = options.jobHourOverrides?.[job.id];
      const hasOverride =
        overrideRaw != null &&
        Number.isFinite(Number(overrideRaw)) &&
        Number(overrideRaw) >= 0;
      const paidHours = hasOverride ? Number(overrideRaw) : originalPaidHours;
      const configuredRate = settings.cleanerJobHourlyRates?.[options.userId]?.[job.jobType];
      const rawRate = cleanerAssignment.payRate ?? configuredRate ?? null;
      const numericRate = rawRate == null ? null : Number(rawRate);
      const rate =
        numericRate != null && Number.isFinite(numericRate) && numericRate > 0
          ? numericRate
          : null;
      const baseAmount = rate != null ? paidHours * rate : 0;
      const approvedExtraAmount = extrasByJob.get(job.id) ?? 0;
      const jobMeta = parseJobInternalNotes(job.internalNotes);
      const transportAllowance = Number(jobMeta.transportAllowances?.[options.userId] ?? 0);
      const comment = options.jobComments?.[job.id]?.trim() || "";
      const isHoursOverridden = hasOverride && Math.abs(paidHours - originalPaidHours) > 0.0001;

      return {
        jobId: job.id,
        date: new Date(job.scheduledDate).toLocaleDateString("en-AU"),
        jobName: `${job.property.name} - ${job.jobType.replace(/_/g, " ")}`,
        property: job.property.name,
        jobType: job.jobType.replace(/_/g, " "),
        split: hasAllocatedHours ? splitCount : 1,
        payBasis,
        rate,
        hours: paidHours,
        originalHours: originalPaidHours,
        isHoursOverridden,
        hoursChangeNote: isHoursOverridden
          ? `${originalPaidHours.toFixed(2)} -> ${paidHours.toFixed(2)}`
          : undefined,
        spentHours: showSpentHours ? timerHours : null,
        baseAmount,
        approvedExtraAmount,
        transportAllowance: Number.isFinite(transportAllowance) && transportAllowance > 0 ? transportAllowance : 0,
        amount: baseAmount + approvedExtraAmount + (transportAllowance > 0 ? transportAllowance : 0),
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
    date: new Date(run.completedAt || run.updatedAt || run.createdAt).toLocaleDateString("en-AU"),
    runName: run.name,
    properties: Array.from(new Set(run.rows.map((row) => row.propertyName))).join(", "),
    amount: Number(run.totals.actualTotalCost ?? 0),
    paymentMethod: run.payment.method.replace(/_/g, " "),
    note: run.reimbursementNote || run.payment.note || undefined,
  }));
  const expenseTotal = expenseRows.reduce((sum, row) => sum + row.amount, 0);
  const shoppingTimeRows = shoppingTimeRuns.map((run) => ({
    runId: run.id,
    date: new Date(run.completedAt || run.updatedAt || run.createdAt).toLocaleDateString("en-AU"),
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

  return {
    cleanerName: user.name ?? user.email,
    cleanerEmail: user.email,
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
    logoUrl: settings.logoUrl,
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
          <td class="cell right">${row.rate != null ? formatCurrency(row.rate) : "Not set"}</td>
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
          .logo { width: 52px; height: 52px; object-fit: contain; border-radius: 10px; border: 1px solid #e5e7eb; padding: 4px; background: #fff; }
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
              <p class="sub"><strong>Period:</strong> ${data.start.toLocaleDateString("en-AU")} to ${data.end.toLocaleDateString("en-AU")}</p>
            </div>
          </div>
          <div>
            <p class="sub"><strong>Generated:</strong> ${new Date().toLocaleString("en-AU")}</p>
          </div>
        </div>

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
  const { chromium } = await import("playwright");
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let launchError: unknown = null;
  try {
    browser = await chromium.launch();
  } catch (err) {
    launchError = err;
    browser = await chromium.launch({ channel: "msedge" }).catch(async () => {
      return chromium.launch({ channel: "chrome" });
    });
  }
  if (!browser) {
    throw launchError ?? new Error("Could not launch browser for invoice PDF generation.");
  }
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "10mm", bottom: "16mm", left: "10mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
