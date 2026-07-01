import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getCleanerInvoiceData } from "@/lib/cleaner/invoice";

/**
 * Predict what each cleaner is going to invoice for a pay period, BEFORE they
 * submit — so the admin can (a) see the money to prepare for upcoming pay days
 * and (b) review each expected invoice with full transparency: which hours the
 * cleaner overrode vs the system's original, which extra payments are approved
 * vs still pending, and — once they DO submit — whether their submitted total
 * matches what we expected (i.e. jobs they forgot to add, or amounts that drift).
 *
 * This reuses getCleanerInvoiceData (the exact same computation the cleaner sees
 * on their own invoice screen), so the prediction and the cleaner's number are
 * derived from one source of truth — no separate, drifting math.
 */

export interface ExpectedInvoiceRow {
  jobId: string;
  date: string;
  jobName: string;
  property: string;
  jobType: string;
  hours: number;
  originalHours: number;
  isHoursOverridden: boolean;
  hoursChangeNote?: string;
  baseAmount: number;
  approvedExtraAmount: number;
  transportAllowance: number;
  amount: number;
  rateMissing: boolean;
  comment?: string;
}

export interface ExpectedCleanerInvoice {
  cleanerId: string;
  cleanerName: string;
  cleanerEmail: string;
  /** Employment type — CONTRACTOR cleaners invoice; others are payrolled. */
  employmentType: string | null;
  expectedTotal: number;
  expectedHours: number;
  jobCount: number;
  /** Rows whose paid-hours the cleaner changed away from the system default. */
  overriddenCount: number;
  /** Approved extra pay already folded into the job lines above. */
  approvedExtraTotal: number;
  /** Extra-pay requests still awaiting admin approval (NOT in expectedTotal). */
  pendingCount: number;
  pendingAmount: number;
  /** Job lines with a missing pay rate — expectedTotal understates until fixed. */
  rateMissingCount: number;
  expenseTotal: number;
  shoppingTimeTotal: number;
  rows: ExpectedInvoiceRow[];
  /** If the cleaner has already submitted an invoice overlapping this period. */
  submission: {
    id: string;
    status: string;
    submittedTotal: number;
    submittedJobCount: number;
    submittedAt: string;
    /** submittedTotal − expectedTotal; ≈0 means it lines up. */
    variance: number;
    /** Expected jobs not represented in the submitted lines (forgot to add). */
    missingJobs: Array<{ jobId: string; jobName: string; date: string; amount: number }>;
  } | null;
}

export interface ExpectedInvoicesResult {
  start: string;
  end: string;
  /** Sum of every non-contractor+contractor expected total — money to prepare. */
  grandExpectedTotal: number;
  /** Sum of pending (unapproved) extra pay across all cleaners. */
  grandPendingAmount: number;
  cleaners: ExpectedCleanerInvoice[];
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Loose match: does a submitted line describe this expected job? */
function submissionCoversJob(
  lines: Array<{ description?: string }>,
  row: { jobName: string; date: string },
): boolean {
  const needleName = row.jobName.toLowerCase().trim();
  return lines.some((l) => (l.description ?? "").toLowerCase().includes(needleName));
}

export async function getExpectedInvoicesForPeriod(opts: {
  startDate?: string;
  endDate?: string;
  cleanerId?: string;
}): Promise<ExpectedInvoicesResult> {
  const cleaners = await db.user.findMany({
    where: {
      role: Role.CLEANER,
      isActive: true,
      ...(opts.cleanerId ? { id: opts.cleanerId } : {}),
    },
    select: { id: true, name: true, email: true, employmentType: true },
    orderBy: { name: "asc" },
  });

  const results: ExpectedCleanerInvoice[] = [];

  for (const cleaner of cleaners) {
    // excludePaidJobs: only count what is still owed (not already on a pay run),
    // so the prediction reflects money genuinely upcoming.
    const data = await getCleanerInvoiceData({
      userId: cleaner.id,
      startDate: opts.startDate,
      endDate: opts.endDate,
      excludePaidJobs: true,
    });

    const hasAnything =
      data.rows.length > 0 ||
      data.expenseTotal > 0 ||
      data.shoppingTimeTotal > 0 ||
      data.pendingAdjustmentCount > 0;
    if (!hasAnything) continue;

    const rows: ExpectedInvoiceRow[] = data.rows.map((r) => ({
      jobId: r.jobId,
      date: r.date,
      jobName: r.jobName,
      property: r.property,
      jobType: r.jobType,
      hours: r.hours,
      originalHours: r.originalHours,
      isHoursOverridden: r.isHoursOverridden,
      hoursChangeNote: r.hoursChangeNote,
      baseAmount: r.baseAmount,
      approvedExtraAmount: r.approvedExtraAmount,
      transportAllowance: r.transportAllowance,
      amount: r.amount,
      rateMissing: r.rateMissing,
      comment: r.comment,
    }));

    // Pair with an already-submitted invoice overlapping this period, if any.
    const submissionRow = await db.cleanerInvoiceSubmission.findFirst({
      where: {
        cleanerId: cleaner.id,
        periodStart: { lte: data.end },
        periodEnd: { gte: data.start },
      },
      orderBy: { createdAt: "desc" },
    });

    let submission: ExpectedCleanerInvoice["submission"] = null;
    if (submissionRow) {
      const lineData = (submissionRow.lineData ?? {}) as {
        lines?: Array<{ description?: string }>;
      };
      const submittedLines = Array.isArray(lineData.lines) ? lineData.lines : [];
      const missingJobs = rows
        .filter((r) => !submissionCoversJob(submittedLines, r))
        .map((r) => ({ jobId: r.jobId, jobName: r.jobName, date: r.date, amount: r.amount }));
      submission = {
        id: submissionRow.id,
        status: submissionRow.status,
        submittedTotal: submissionRow.totalAmount,
        submittedJobCount: submissionRow.jobCount,
        submittedAt: submissionRow.createdAt.toISOString(),
        variance: Number((submissionRow.totalAmount - data.estimatedPay).toFixed(2)),
        missingJobs,
      };
    }

    results.push({
      cleanerId: cleaner.id,
      cleanerName: cleaner.name ?? data.cleanerName,
      cleanerEmail: cleaner.email,
      employmentType: cleaner.employmentType ?? null,
      expectedTotal: Number(data.estimatedPay.toFixed(2)),
      expectedHours: Number(data.hours.toFixed(2)),
      jobCount: data.rows.length,
      overriddenCount: data.rows.filter((r) => r.isHoursOverridden).length,
      approvedExtraTotal: Number(
        data.rows.reduce((sum, r) => sum + (r.approvedExtraAmount ?? 0), 0).toFixed(2),
      ),
      pendingCount: data.pendingAdjustmentCount,
      pendingAmount: Number(data.pendingAdjustmentAmount.toFixed(2)),
      rateMissingCount: data.rows.filter((r) => r.rateMissing).length,
      expenseTotal: Number(data.expenseTotal.toFixed(2)),
      shoppingTimeTotal: Number(data.shoppingTimeTotal.toFixed(2)),
      rows,
      submission,
    });
  }

  const grandExpectedTotal = Number(
    results.reduce((sum, c) => sum + c.expectedTotal + c.expenseTotal + c.shoppingTimeTotal, 0).toFixed(2),
  );
  const grandPendingAmount = Number(results.reduce((sum, c) => sum + c.pendingAmount, 0).toFixed(2));

  // Derive the resolved window from any computed cleaner (falls back to inputs).
  const start = opts.startDate ?? fmtDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const end = opts.endDate ?? fmtDate(new Date());

  return {
    start,
    end,
    grandExpectedTotal,
    grandPendingAmount,
    cleaners: results,
  };
}
