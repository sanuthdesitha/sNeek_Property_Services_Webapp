import { JobStatus, PayAdjustmentStatus, Prisma, QaAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { computeCleanerPay } from "@/lib/finance/job-money";
import {
  adjustmentSignedAmount,
  partitionAdjustmentsForInvoice,
} from "@/lib/finance/pay-adjustments";
import {
  computeQaAssignmentPay,
  isQaAssignmentAvailableForSettlement,
  qaAssignmentSettlementAmount,
  sumQaPay,
} from "@/lib/finance/qa-pay";
import {
  listCleanerApprovedShoppingTimeRuns,
  listCleanerReimbursableShoppingRuns,
} from "@/lib/inventory/shopping-runs";
import { sydneyDayStart, sydneyDayEndInclusive } from "@/lib/time/sydney-range";

interface InvoiceOptions {
  userId: string;
  startDate?: string;
  endDate?: string;
  showSpentHours?: boolean;
  /**
   * When false, the rendered PDF hides ALL hours: the Paid Hours summary tile,
   * the Paid Hours table column, the Hours Spent column, and the Hours Changed
   * column. This is the figure cleaners forward to accounts, so hiding hours must
   * be total — no hour value may leak through any column. Defaults to true (hours
   * shown). Data/on-screen editing views are unaffected; this only gates the PDF.
   */
  showHours?: boolean;
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
  /**
   * When true, exclude jobs the cleaner has ALREADY submitted on a prior invoice
   * (tracked via CleanerInvoiceSubmission.lineData.jobIds). Keeps a job from being
   * invoiced twice and stops it reappearing on the cleaner's invoice screen once
   * submitted. Used by the cleaner-facing preview/download/send.
   */
  excludeInvoicedJobs?: boolean;
  /**
   * Job ids the cleaner has removed from THIS invoice (transient — they stay
   * available for a future invoice). Also excludes matching expense/shopping runs
   * via excludedRunIds.
   */
  excludedJobIds?: string[];
  /** Shopping-run ids the cleaner removed from this invoice. */
  excludedRunIds?: string[];
  /**
   * When re-rendering an EXISTING CleanerInvoiceSubmission, pass its id so the
   * adjustments it already settled stay visible on it (mirrors includePaidRunId
   * for payroll runs). Without it, a previously-stamped adjustment is treated as
   * spent and disappears from its own invoice.
   */
  includeInvoiceId?: string;
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
  /** When false the PDF omits every hours column/tile. Defaults to true. */
  showHours: boolean;
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
  /**
   * Approved extra payments NOT tied to a specific job — they appear as their
   * own invoice lines with the cleaner's description (e.g. a one-off bonus or a
   * property-level allowance) instead of being folded into a job's clean price.
   */
  extraLineRows: Array<{
    id: string;
    date: string;
    description: string;
    amount: number;
  }>;
  extraLineTotal: number;
  /**
   * COMPLETED QA inspections this invoice bills. A QA inspector holds no cleaner
   * assignments, so these never arrive via `rows` — they are their own settlement
   * stream on the same rail (see the QA block in getCleanerInvoiceData).
   */
  qaInspectionRows: Array<{
    assignmentId: string;
    jobId: string | null;
    jobNumber: string | null;
    date: string;
    property: string;
    /** Resolved pay mode: FIXED or HOURLY (a NONE/$0 inspection is not billed). */
    mode: string;
    /** How the hours were derived (ALLOCATED / ACTUAL / DEFAULT_HOURS / NONE). */
    basis: string;
    hours: number;
    rate: number;
    rateMissing: boolean;
    note?: string;
    amount: number;
  }>;
  qaInspectionTotal: number;
  /**
   * Ids of every QaAssignment this invoice settles. The send route stamps these
   * with includedInCleanerInvoiceId + freezes paySettledAmount so neither the
   * next invoice nor a payroll run can pay them again.
   */
  includedQaAssignmentIds: string[];
  /**
   * Ids of every CleanerPayAdjustment this invoice settles (both the ones
   * folded into a job line and the standalone carry-over lines). The send route
   * stamps these with includedInCleanerInvoiceId so the NEXT invoice cannot
   * bill them again.
   */
  includedAdjustmentIds: string[];
  pendingAdjustmentCount: number;
  pendingAdjustmentAmount: number;
  companyName: string;
  logoUrl?: string;
}

function resolveDateRange(startDate?: string, endDate?: string) {
  const now = new Date();
  // Use Sydney calendar boundaries so the cleaner-invoice / expected-invoice
  // window matches the payroll engine + finance summary (which use
  // sydneyDayStart/sydneyDayEndInclusive). Hardcoded UTC `Z` boundaries shifted
  // the window ~10-14h, bucketing edge-of-period jobs differently between the
  // invoice and what payroll actually paid.
  const start = startDate
    ? sydneyDayStart(startDate)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = endDate ? sydneyDayEndInclusive(endDate) : now;
  return { start, end };
}

export async function getCleanerInvoiceData(options: InvoiceOptions): Promise<CleanerInvoiceData> {
  const { start, end } = resolveDateRange(options.startDate, options.endDate);
  const showSpentHours = options.showSpentHours === true;
  const showHours = options.showHours !== false;
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

  // Jobs the cleaner has already put on a submitted invoice — never show again.
  const alreadyInvoicedJobIds: string[] = [];
  if (options.excludeInvoicedJobs) {
    const priorSubmissions = await db.cleanerInvoiceSubmission.findMany({
      where: { cleanerId: options.userId, status: { not: "VOID" } },
      select: { lineData: true },
    });
    for (const sub of priorSubmissions) {
      const ld = (sub.lineData ?? {}) as { jobIds?: unknown };
      if (Array.isArray(ld.jobIds)) {
        for (const id of ld.jobIds) if (typeof id === "string") alreadyInvoicedJobIds.push(id);
      }
    }
  }
  const excludedJobIds = Array.from(
    new Set([...(options.excludedJobIds ?? []), ...alreadyInvoicedJobIds]),
  );

  const jobWhere: Prisma.JobWhereInput = {
    // Bucket by completion date when set (next-day/custom), else scheduled date.
    OR: [
      { completedAt: { gte: start, lte: end } },
      { completedAt: null, scheduledDate: { gte: start, lte: end } },
    ],
    status: {
      in: [JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED],
    },
    // Only jobs this cleaner is CURRENTLY assigned to (removedAt: null). Without
    // this, a job reassigned away from the cleaner (their assignment removed and
    // given to someone else) still matched via the stale assignment row, so the
    // cleaner kept invoicing another cleaner's job → duplicate payments. Matches
    // the canonical `removedAt: null` filter used by payroll/finance.
    assignments: { some: { userId: options.userId, removedAt: null } },
    ...(excludedJobIds.length > 0 ? { id: { notIn: excludedJobIds } } : {}),
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

  // EVERY approved, not-yet-settled adjustment for this cleaner — NOT just the
  // ones whose job happens to be on this invoice.
  //
  // The old query was `jobId: { in: jobIds }`, and jobIds came from jobs the
  // cleaner is CURRENTLY ASSIGNED to inside the period. That meant an approved
  // adjustment vanished whenever its job wasn't on the invoice — most visibly
  // the QA-inspector credit (lib/qa/rework-transfers.ts and the
  // QA_RECTIFICATION_PAY row in app/api/admin/qa/issues/[id]/route.ts are
  // written against the CLEANER's job, which the QA was never assigned to), and
  // any adjustment approved after its job's period had already been invoiced.
  // Approving it changed nothing the payee was ever paid.
  //
  // Selection is now purely "APPROVED and neither settlement stamp set"
  // (lib/finance/pay-adjustments.ts). Rows with a job on this invoice fold into
  // that job's line as before; everything else becomes its own carry-over line
  // so it reaches the NEXT invoice exactly once.
  const settleableAdjustments = await db.cleanerPayAdjustment.findMany({
    where: {
      cleanerId: options.userId,
      status: PayAdjustmentStatus.APPROVED,
      includedInPayrollRunId: null,
      ...(options.includeInvoiceId
        ? {
            OR: [
              { includedInCleanerInvoiceId: null },
              { includedInCleanerInvoiceId: options.includeInvoiceId },
            ],
          }
        : { includedInCleanerInvoiceId: null }),
    },
    select: {
      id: true,
      jobId: true,
      title: true,
      status: true,
      approvedAmount: true,
      requestedAmount: true,
      includedInPayrollRunId: true,
      includedInCleanerInvoiceId: true,
      cleanerNote: true,
      requestedAt: true,
      reviewedAt: true,
    },
    orderBy: { requestedAt: "asc" },
  });

  // ── QA inspections ────────────────────────────────────────────────────
  //
  // The SECOND settlement stream on this rail. A QA inspector is paid for the
  // inspection itself (lib/finance/qa-pay.ts) and holds NO cleaner assignment,
  // so nothing they did would ever reach `payableJobs` — an inspections-only
  // payee's invoice would come out empty and the money would silently never be
  // billed. This is the invoice mirror of the `extraPayees` fix in
  // lib/finance/payroll.ts.
  //
  // PERIOD vs STAMP — deliberately the same decision the adjustment rail and the
  // committable payroll run already made: the *stamp* is what prevents double
  // payment, never the date window. So there is NO lower bound: an inspection
  // completed before a period closed but settled late is still billed, exactly
  // once, on whichever invoice picks it up next. The upper bound (completedAt <=
  // end) is kept only so an inspection completed AFTER the invoiced period isn't
  // dragged into an earlier-dated invoice — it will be on the next one. A
  // COMPLETED row with a null completedAt (data anomaly) is included rather than
  // dropped: it is work that was done and is owed.
  const qaAssignmentRows = await db.qaAssignment.findMany({
    where: {
      assignedToId: options.userId,
      status: QaAssignmentStatus.COMPLETED,
      // Never touch an inspection a payroll run already paid — the cross-rail
      // half of the double-pay guard.
      includedInPayrollRunId: null,
      AND: [
        { OR: [{ completedAt: { lte: end } }, { completedAt: null }] },
        options.includeInvoiceId
          ? {
              OR: [
                { includedInCleanerInvoiceId: null },
                { includedInCleanerInvoiceId: options.includeInvoiceId },
              ],
            }
          : { includedInCleanerInvoiceId: null },
      ],
    },
    select: {
      id: true,
      status: true,
      completedAt: true,
      onSiteMinutes: true,
      payMode: true,
      payAmount: true,
      payHourlyRate: true,
      payHoursAllocated: true,
      payNote: true,
      paySettledAmount: true,
      includedInPayrollRunId: true,
      includedInCleanerInvoiceId: true,
      job: {
        select: { id: true, jobNumber: true, property: { select: { name: true } } },
      },
    },
    orderBy: [{ completedAt: "asc" }],
  });

  const qaInspectionRows = qaAssignmentRows
    // THE selector — re-applied in memory so the rule lives in one pure place
    // even if the query above ever drifts. It checks BOTH stamps.
    .filter((row) =>
      isQaAssignmentAvailableForSettlement(row, {
        includeInvoiceId: options.includeInvoiceId ?? null,
      })
    )
    .map((row) => {
      const pay = computeQaAssignmentPay({
        assignment: row,
        inspector: { hourlyRate: user.hourlyRate },
        settings: settings.qaPay,
      });
      return {
        assignmentId: row.id,
        jobId: row.job?.id ?? null,
        jobNumber: row.job?.jobNumber ?? null,
        date: row.completedAt
          ? new Date(row.completedAt).toLocaleDateString("en-AU", {
              timeZone: "Australia/Sydney",
            })
          : "-",
        property: row.job?.property?.name ?? "Inspection",
        mode: pay.mode,
        basis: pay.basis,
        hours: pay.hours,
        rate: pay.rate,
        rateMissing: pay.rateMissing,
        note: row.payNote ?? undefined,
        // A frozen paySettledAmount always wins over a recomputation, so
        // re-rendering an existing invoice shows exactly what it billed.
        amount: qaAssignmentSettlementAmount(row, pay.amount),
      };
    })
    // A $0 inspection (mode NONE, or nothing configured) is not a payable line —
    // same rule as the payroll rail. It stays unstamped and therefore selectable
    // if it is later given a real amount.
    .filter((row) => row.amount > 0);
  const qaInspectionTotal = sumQaPay(qaInspectionRows);

  const adjustmentSplit = partitionAdjustmentsForInvoice(settleableAdjustments, {
    jobIdsOnInvoice: jobIds,
    includeInvoiceId: options.includeInvoiceId ?? null,
  });
  const approvedAdjustments = adjustmentSplit.perJobRows;
  const pendingAdjustments = await db.cleanerPayAdjustment.findMany({
    where: {
      cleanerId: options.userId,
      status: PayAdjustmentStatus.PENDING,
      OR: [
        {
          // Job-linked: match the same window used for payable jobs.
          job: {
            OR: [
              { completedAt: { gte: start, lte: end } },
              { completedAt: null, scheduledDate: { gte: start, lte: end } },
            ],
          },
        },
        // Unlinked (no job): fall back to the request date being in the window.
        { jobId: null, requestedAt: { gte: start, lte: end } },
      ],
    },
    select: {
      requestedAmount: true,
    },
  });

  // Approved adjustments with no line to fold into: unlinked extras AND
  // job-linked ones whose job isn't on this invoice (QA credits, late
  // approvals). They become their own lines, carried into whichever invoice is
  // generated next, and are settled exactly once by the inclusion stamp.
  // No date window: an adjustment approved after its period closed is still
  // owed, and dropping it for being "out of period" is how money went missing.
  const unlinkedApprovedAdjustments = adjustmentSplit.carryOverRows;

  const extrasByJob = adjustmentSplit.perJobTotals;
  const extraNotesByJob = new Map<string, string[]>();
  for (const row of approvedAdjustments) {
    if (!row.jobId) continue;
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
      // Only an ACTIVE assignment for this cleaner earns a line. Do not fall back
      // to a removed assignment — a cleaner reassigned off the job must not keep
      // invoicing it (that caused cross-cleaner duplicate pay). The query already
      // filters to active assignments; this is the matching in-memory guard.
      const cleanerAssignment = activeAssignments.find(
        (assignment) => assignment.userId === options.userId
      );

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

      // Rework pay is governed ENTIRELY by the QA decision, never hours×rate.
      // reworkPayAmount is the amount QA set (null when unpaid), so an unpaid
      // rework contributes $0 and a paid one contributes exactly QA's amount.
      // This overrides the cleanerPayouts meta so a missing/legacy meta entry
      // can't leak an unpaid rework back into pay at the hourly rate.
      const reworkCustomPayout = job.isRework
        ? typeof job.reworkPayAmount === "number" && Number.isFinite(job.reworkPayAmount)
          ? job.reworkPayAmount
          : 0
        : undefined;
      const effectiveCustomPayout =
        reworkCustomPayout !== undefined ? reworkCustomPayout : jobMeta.cleanerPayouts?.[options.userId];

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
          customPayout: effectiveCustomPayout,
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
        // Use the SCHEDULED date (matches the jobs page + the scheduledDate sort
        // order). Using completedAt here caused a job scheduled late one day but
        // completed after the Sydney midnight boundary to display as the next
        // day, misaligning dates against back-to-back rows (e.g. 12th → 13th).
        date: new Date(job.scheduledDate).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" }),
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

  const excludedRunSet = new Set(options.excludedRunIds ?? []);
  const shoppingExpenseRuns = (
    await listCleanerReimbursableShoppingRuns({ cleanerId: options.userId, start, end })
  ).filter((run) => !excludedRunSet.has(run.id));
  const shoppingTimeRuns = (
    await listCleanerApprovedShoppingTimeRuns({ cleanerId: options.userId, start, end })
  ).filter((run) => !excludedRunSet.has(run.id));
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

  const extraLineRows = unlinkedApprovedAdjustments.map((adj) => {
    // Signed: a carry-over row can be a DEDUCTION (negative) as well as an
    // addition — e.g. a QA rework deduction against a job that has already been
    // invoiced. Both must reach the next invoice with the correct sign.
    const amount = adjustmentSignedAmount(adj);
    const label = adj.title?.trim() || adj.cleanerNote?.trim() || "Extra payment";
    return {
      id: adj.id,
      date: new Date(adj.reviewedAt ?? adj.requestedAt).toLocaleDateString("en-AU", {
        timeZone: "Australia/Sydney",
      }),
      description: amount < 0 ? `Deduction — ${label}` : label,
      amount,
    };
  });
  const extraLineTotal = extraLineRows.reduce((sum, row) => sum + row.amount, 0);

  const hours = rows.reduce((sum, row) => sum + row.hours, 0);
  const estimatedPay =
    rows.reduce((sum, row) => sum + row.amount, 0) +
    extraLineTotal +
    expenseTotal +
    shoppingTimeTotal +
    qaInspectionTotal;
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
    showHours,
    rows,
    expenseRows,
    expenseTotal,
    shoppingTimeRows,
    shoppingTimeTotal,
    extraLineRows,
    extraLineTotal,
    qaInspectionRows,
    qaInspectionTotal,
    includedQaAssignmentIds: qaInspectionRows.map((row) => row.assignmentId),
    includedAdjustmentIds: adjustmentSplit.includedRows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
    pendingAdjustmentCount: pendingAdjustments.length,
    pendingAdjustmentAmount,
    companyName: settings.companyName,
    logoUrl: settings.logoUrl || settings.reportLogoUrl,
  };
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

export function buildCleanerInvoiceHtml(data: CleanerInvoiceData) {
  // Stable, human-readable invoice reference derived from the billing period.
  const invoiceNumber = `INV-${data.start.toISOString().slice(0, 10).replace(/-/g, "")}-${data.end
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "")}`;
  // When hours are hidden, EVERY hours-bearing column disappears — Paid Hours,
  // Hours Spent, and the Hours Changed override note (which prints hour values).
  // This is the amount cleaners send to accounts, so no hour may leak through.
  const showHours = data.showHours !== false;
  const showSpentHours = showHours && data.showSpentHours;
  const includeTransportColumn = data.rows.some((row) => row.transportAllowance > 0);
  const includeHoursChangeColumn = showHours && data.rows.some((row) => row.isHoursOverridden);
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
  const extraLineRowsHtml = data.extraLineRows
    .map(
      (row) => `
        <tr>
          <td class="cell">${row.date}</td>
          <td class="cell">${escapeHtml(row.description)}</td>
          <td class="cell right">${formatCurrency(row.amount)}</td>
        </tr>
      `
    )
    .join("");
  // QA inspection lines. Basis text spells the hourly maths out (rate × hours)
  // so the figure is self-explaining — but hours are money-adjacent detail and
  // must obey showHours exactly like every other hours-bearing cell on this
  // invoice, so the multiplication collapses to the bare rate when hidden.
  const qaInspectionRows = data.qaInspectionRows ?? [];
  const qaInspectionTotal = Number(
    data.qaInspectionTotal ?? qaInspectionRows.reduce((sum, row) => sum + row.amount, 0)
  );
  const qaIncludeNoteColumn = qaInspectionRows.some((row) => Boolean(row.note?.trim()));
  const qaInspectionRowsHtml = qaInspectionRows
    .map((row) => {
      const basis =
        row.mode === "HOURLY"
          ? showHours
            ? `Hourly — ${formatCurrency(row.rate)} × ${row.hours.toFixed(2)}h`
            : `Hourly — ${formatCurrency(row.rate)}/hr`
          : "Fixed";
      return `
        <tr>
          <td class="cell">${row.date}</td>
          <td class="cell">${escapeHtml(row.property)}</td>
          <td class="cell">${basis}${row.rateMissing ? " (rate not set)" : ""}</td>
          <td class="cell right">${formatCurrency(row.amount)}</td>
          ${qaIncludeNoteColumn ? `<td class="cell">${row.note?.trim() ? escapeHtml(row.note) : "-"}</td>` : ""}
        </tr>
      `;
    })
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
            <h2>From (Contractor)</h2>
            <p><strong>${escapeHtml(data.cleanerName)}</strong></p>
            ${cleanerLines}
          </div>
          <div class="party">
            <h2>Bill to</h2>
            <p><strong>${escapeHtml(data.companyName)}</strong></p>
            <p>Accounts Payable</p>
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
          ${showHours ? `<td class="cell right">${row.hours.toFixed(2)}</td>` : ""}
          ${includeHoursChangeColumn ? `<td class="cell">${row.hoursChangeNote ? escapeHtml(row.hoursChangeNote) : "-"}</td>` : ""}
          ${showSpentHours ? `<td class="cell right">${(row.spentHours ?? 0).toFixed(2)}</td>` : ""}
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
          .logo { max-width: 180px; max-height: 64px; width: auto; height: auto; object-fit: contain; background: #ffffff; border-radius: 8px; padding: 5px; }
          .parties { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 14px 0; }
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
              <h1 class="title">Tax Invoice</h1>
              <p class="sub"><strong>From:</strong> ${escapeHtml(data.cleanerName)} (${escapeHtml(data.cleanerEmail)})</p>
              <p class="sub"><strong>Period:</strong> ${data.start.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" })} to ${data.end.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" })}</p>
            </div>
          </div>
          <div style="text-align:right;">
            <p class="sub"><strong>Invoice #:</strong> ${escapeHtml(invoiceNumber)}</p>
            <p class="sub"><strong>Issued:</strong> ${new Date().toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" })}</p>
            ${data.cleanerAbn ? `<p class="sub"><strong>ABN:</strong> ${escapeHtml(data.cleanerAbn)}</p>` : '<p class="sub" style="color:#b91c1c;">No ABN on file</p>'}
          </div>
        </div>
        ${partiesHtml}

        <div class="summary">
          ${
            showHours
              ? `<div class="box">
            <div class="label">Paid Hours</div>
            <div class="value">${data.hours.toFixed(2)}</div>
          </div>`
              : ""
          }
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
          ${
            qaInspectionRows.length > 0
              ? `<div class="box">
            <div class="label">QA Inspections</div>
            <div class="value">${formatCurrency(qaInspectionTotal)}</div>
          </div>`
              : ""
          }
          <div class="box">
            <div class="label">Payable Jobs</div>
            <div class="value">${data.rows.length}</div>
          </div>
          <div class="box">
            <div class="label">Invoice Type</div>
            <div class="value">Contractor</div>
          </div>
        </div>

        ${
          data.rows.length > 0
            ? `<p class="rule">Pay rule: fixed/allocated hours are paid in full and split equally across assigned cleaners. If fixed hours are not set, pay uses the cleaner's clocked timer. Approved extras are added per job.</p>`
            : ""
        }
        ${
          qaInspectionRows.length > 0
            ? `<p class="rule">QA inspection pay rule: each completed inspection is paid either a fixed amount or the applicable hourly rate for the allocated/on-site hours. Each inspection is billed once — on this invoice or a pay run, never both.</p>`
            : ""
        }
        ${showHours && changedRowsCount > 0 ? `<p class="changed-note">Hours overridden on ${changedRowsCount} row(s). Changed rows are highlighted.</p>` : ""}

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
          data.extraLineRows.length > 0
            ? `
              <h2 style="margin-top:20px;font-size:16px;">Extra payments (not job-linked)</h2>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th class="right">Amount</th>
                  </tr>
                </thead>
                <tbody>${extraLineRowsHtml}</tbody>
              </table>
            `
            : ""
        }

        ${
          qaInspectionRows.length > 0
            ? `
              <h2 style="margin-top:20px;font-size:16px;">QA inspections</h2>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Property</th>
                    <th>Basis</th>
                    <th class="right">Amount</th>
                    ${qaIncludeNoteColumn ? `<th>Note</th>` : ""}
                  </tr>
                </thead>
                <tbody>${qaInspectionRowsHtml}</tbody>
                <tfoot>
                  <tr>
                    <td class="cell" colspan="3"><strong>QA inspections subtotal</strong></td>
                    <td class="cell right"><strong>${formatCurrency(qaInspectionTotal)}</strong></td>
                    ${qaIncludeNoteColumn ? `<td class="cell"></td>` : ""}
                  </tr>
                </tfoot>
              </table>
            `
            : ""
        }

        ${
          data.rows.length > 0
            ? `
              <h2 style="margin-top:20px;font-size:16px;">Cleaning jobs</h2>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Property</th>
                    <th>Job Type</th>
                    <th class="right">Split</th>
                    <th class="right">Rate</th>
                    ${showHours ? `<th class="right">Paid Hours</th>` : ""}
                    ${includeHoursChangeColumn ? `<th>Hours Changed</th>` : ""}
                    ${showSpentHours ? `<th class="right">Hours Spent</th>` : ""}
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
            : // Only claim "nothing here" when the invoice really is empty. An
              // inspections-only invoice is complete and must not read as if the
              // payee had cleans that went missing.
              qaInspectionRows.length > 0 ||
                data.extraLineRows.length > 0 ||
                data.expenseRows.length > 0 ||
                data.shoppingTimeRows.length > 0
              ? ""
              : `<div class="empty">No payable work found in this date range.</div>`
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
