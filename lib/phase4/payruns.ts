import { randomUUID } from "crypto";
import { JobStatus, PayAdjustmentStatus, Prisma, QaAssignmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getCleanerInvoiceData } from "@/lib/cleaner/invoice";
import { readSettingStore, writeSettingStore } from "@/lib/phase4/store";
import {
  releaseShoppingSettlementsForPayrollRun,
  stampShoppingSettlementsForPayrollRun,
} from "@/lib/inventory/shopping-runs";
// The payee roles the invoice rail serves (CLEANER + QA_INSPECTOR). Imported, not
// re-declared, so this rail can never drift from lib/invoicing/access.ts.
import { INVOICE_PAYEE_ROLES } from "@/lib/profile/completeness";

const PAYRUNS_KEY = "phase4_payruns_v1";

export type PayRunStatus = "DRAFT" | "LOCKED" | "PAID";

/**
 * One payee's line on a pay run.
 *
 * NAMING: the `cleaner*` field names are load-bearing for BACKWARD COMPATIBILITY
 * — stored runs in the AppSetting blob use them and `sanitizeLine` reads them.
 * They are NOT honest: this rail pays every INVOICE_PAYEE_ROLE, so a line may
 * belong to a QA inspector who holds no cleaner assignments at all. `payeeRole`
 * records which, without renaming anything a stored run depends on.
 */
export interface PayRunLine {
  /** Payee user id (not necessarily a CLEANER — see payeeRole). */
  cleanerId: string;
  /** Payee display name. */
  cleanerName: string;
  /** Payee email. */
  cleanerEmail: string;
  /** Role of the payee at the time the line was computed (CLEANER / QA_INSPECTOR). */
  payeeRole?: string | null;
  jobsCount: number;
  /** Completed QA inspections billed on this line (0 for a cleans-only payee). */
  inspectionsCount?: number;
  /** Approved pay adjustments settled by this line. */
  adjustmentsCount?: number;
  paidHours: number;
  /**
   * Total paid to this payee. SIGNED — a payee whose period contains only a
   * deduction is owed a negative amount, and clamping it to 0 would silently
   * delete the deduction (see lib/finance/pay-adjustments.ts).
   */
  amount: number;
}

export interface PayRunRecord {
  id: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: PayRunStatus;
  lines: PayRunLine[];
  totals: {
    cleaners: number;
    jobs: number;
    paidHours: number;
    amount: number;
  };
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
  lockedByUserId: string | null;
  paidAt: string | null;
  paidByUserId: string | null;
  notes: string | null;
}

interface PayRunStore {
  runs: PayRunRecord[];
}

const DEFAULT_STORE: PayRunStore = { runs: [] };

function toIsoDateOnly(input: string) {
  const d = new Date(`${input}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid date.");
  }
  return d.toISOString().slice(0, 10);
}

function sanitizeLine(input: unknown): PayRunLine | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const cleanerId = String(row.cleanerId ?? "").trim();
  const cleanerEmail = String(row.cleanerEmail ?? "").trim();
  if (!cleanerId || !cleanerEmail) return null;
  // Signed, NOT clamped. `Math.max(0, …)` here used to erase a net-negative line
  // (a payee whose period is dominated by an approved deduction) the moment the
  // run was read back — the exact failure mode lib/finance/pay-adjustments.ts
  // documents. Only NaN is coerced, and to 0.
  const amountRaw = Number(row.amount ?? 0);
  return {
    cleanerId,
    cleanerName: String(row.cleanerName ?? cleanerEmail).trim() || cleanerEmail,
    cleanerEmail,
    payeeRole: row.payeeRole ? String(row.payeeRole) : null,
    jobsCount: Math.max(0, Number(row.jobsCount ?? 0)),
    inspectionsCount: Math.max(0, Number(row.inspectionsCount ?? 0)),
    adjustmentsCount: Math.max(0, Number(row.adjustmentsCount ?? 0)),
    paidHours: Math.max(0, Number(row.paidHours ?? 0)),
    amount: Number.isFinite(amountRaw) ? amountRaw : 0,
  };
}

function sanitizeRun(input: unknown): PayRunRecord | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const createdByUserId = String(row.createdByUserId ?? "").trim();
  if (!id || !createdByUserId) return null;
  const lines = Array.isArray(row.lines)
    ? row.lines.map(sanitizeLine).filter((line): line is PayRunLine => Boolean(line))
    : [];
  const totals = {
    cleaners: lines.length,
    jobs: lines.reduce((sum, line) => sum + line.jobsCount, 0),
    paidHours: lines.reduce((sum, line) => sum + line.paidHours, 0),
    amount: lines.reduce((sum, line) => sum + line.amount, 0),
  };
  return {
    id,
    name: String(row.name ?? "Pay Run").slice(0, 120),
    periodStart: String(row.periodStart ?? ""),
    periodEnd: String(row.periodEnd ?? ""),
    status: row.status === "LOCKED" || row.status === "PAID" ? row.status : "DRAFT",
    lines,
    totals,
    createdByUserId,
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? new Date().toISOString()),
    lockedAt: row.lockedAt ? String(row.lockedAt) : null,
    lockedByUserId: row.lockedByUserId ? String(row.lockedByUserId) : null,
    paidAt: row.paidAt ? String(row.paidAt) : null,
    paidByUserId: row.paidByUserId ? String(row.paidByUserId) : null,
    notes: row.notes ? String(row.notes).slice(0, 2000) : null,
  };
}

function sanitizeStore(input: unknown, fallback: PayRunStore): PayRunStore {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const row = input as Record<string, unknown>;
  const runs = Array.isArray(row.runs)
    ? row.runs.map(sanitizeRun).filter((run): run is PayRunRecord => Boolean(run))
    : [];
  return { runs };
}

async function readStore() {
  return readSettingStore(PAYRUNS_KEY, DEFAULT_STORE, sanitizeStore);
}

async function writeStore(
  version: number,
  data: PayRunStore,
  client?: Prisma.TransactionClient
) {
  return writeSettingStore(PAYRUNS_KEY, { version, data }, client);
}

export interface ComputedLines {
  lines: PayRunLine[];
  // Every job whose pay is captured by these lines. Stamped with the run id so the
  // same job can't be paid again by another phase4 run or by the primary engine.
  jobIds: string[];
  /**
   * Every approved CleanerPayAdjustment whose money is inside `lines`. These MUST
   * be stamped with the run id: `estimatedPay` already includes their signed
   * amount, so leaving them unstamped means the primary payroll engine or the
   * payee's next invoice pays them a SECOND time.
   */
  adjustmentIds: string[];
  /** Every COMPLETED QaAssignment whose money is inside `lines`. Same reason. */
  qaAssignmentIds: string[];
  /**
   * Per-inspection amount THIS run pays, threaded through from
   * `invoice.qaInspectionRows` rather than recomputed, so the figure frozen into
   * `paySettledAmount` is provably the figure that was paid.
   */
  qaAssignmentAmounts: Array<{ id: string; amount: number }>;
  /**
   * The FOURTH stream: shopping. `estimatedPay` folds in BOTH the out-of-pocket
   * reimbursement and the approved shopping time, so both must be stamped for
   * exactly the reason the adjustments above must be — an unstamped row is paid
   * a second time by the payee's next cleaner invoice or by another payroll run.
   *
   * Keyed on shopping RUN id, not settlement id: every write path in
   * lib/inventory/shopping-runs.ts REPLACES the settlement row, so a settlement
   * id captured here would be stale by the time we stamped it.
   */
  shoppingExpenseAmounts: Array<{ runId: string; amount: number }>;
  /** Approved shopping TIME. Settles independently of the expense above. */
  shoppingTimeAmounts: Array<{ runId: string; amount: number }>;
}

/** The subset of a payee's invoice this rail needs. Keeps the merge logic pure. */
export interface PayeeInvoiceSlice {
  cleanerName: string;
  cleanerEmail: string;
  payeeRole?: string | null;
  hours: number;
  estimatedPay: number;
  rows: Array<{ jobId: string }>;
  qaInspectionRows: Array<{ assignmentId: string; amount: number }>;
  includedQaAssignmentIds: string[];
  includedAdjustmentIds: string[];
  /** Shopping reimbursements billed on this payee's slice. */
  expenseRows: Array<{ runId: string; amount: number }>;
  /** Approved shopping time billed on this payee's slice. */
  shoppingTimeRows: Array<{ runId: string; amount: number }>;
}

export interface PayeeInvoiceEntry {
  payeeId: string;
  payeeRole?: string | null;
  invoice: PayeeInvoiceSlice;
}

/**
 * Merge the assignment-driven payee roster with payees discovered through the
 * OTHER two settlement streams, deduped by id and preserving roster order.
 *
 * Mirrors `getPayrollSummary`'s `extraPayees` step. Without it a QA inspector —
 * who holds no cleaner assignments and therefore matches no job-assignment query
 * — could never appear on a pay run, and neither could a cleaner whose period
 * contains only an adjustment or an inspection.
 */
export function mergePayeeIds(
  assignmentPayeeIds: readonly string[],
  extraPayeeIds: readonly string[]
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of [...assignmentPayeeIds, ...extraPayeeIds]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}

/**
 * Does this payee have anything at all to be paid for?
 *
 * The old test was `invoice.rows.length === 0` — jobs only — which filtered out
 * exactly the payees BUG 2 was about (an inspections-only inspector, an
 * adjustment-only cleaner) right after widening the query to find them. All three
 * streams count now, and a zero-amount payee with no rows anywhere is skipped so
 * the run isn't padded with empty lines. A NON-zero amount always earns a line,
 * including a negative one (a net deduction is still a settlement).
 */
export function payeeHasPayableWork(invoice: PayeeInvoiceSlice): boolean {
  if (invoice.rows.length > 0) return true;
  if (invoice.qaInspectionRows.length > 0) return true;
  if (invoice.includedAdjustmentIds.length > 0) return true;
  if ((invoice.expenseRows ?? []).length > 0) return true;
  if ((invoice.shoppingTimeRows ?? []).length > 0) return true;
  return Number(invoice.estimatedPay.toFixed(2)) !== 0;
}

/**
 * Fold per-payee invoices into the run's lines plus the id sets that must be
 * stamped. Pure — every DB decision is made by the caller.
 */
export function buildComputedLines(entries: readonly PayeeInvoiceEntry[]): ComputedLines {
  const lines: PayRunLine[] = [];
  const jobIds = new Set<string>();
  const adjustmentIds = new Set<string>();
  const qaAmounts = new Map<string, number>();
  const shoppingExpense = new Map<string, number>();
  const shoppingTime = new Map<string, number>();

  for (const entry of entries) {
    const invoice = entry.invoice;
    if (!payeeHasPayableWork(invoice)) continue;
    for (const row of invoice.rows) jobIds.add(row.jobId);
    for (const id of invoice.includedAdjustmentIds) adjustmentIds.add(id);
    // Shopping, same rule as the inspections below: take the amount from the ROW
    // (what this run is paying) rather than recomputing it, so the figure frozen
    // into the settlement is provably the figure that was paid.
    for (const row of invoice.expenseRows ?? []) {
      shoppingExpense.set(row.runId, Number(Number(row.amount).toFixed(2)));
    }
    for (const row of invoice.shoppingTimeRows ?? []) {
      shoppingTime.set(row.runId, Number(Number(row.amount).toFixed(2)));
    }
    // Take the amount from the ROW (what was billed), not from a recomputation.
    for (const row of invoice.qaInspectionRows) {
      qaAmounts.set(row.assignmentId, Number(Number(row.amount).toFixed(2)));
    }
    // Defensive: includedQaAssignmentIds is derived from qaInspectionRows, but if
    // an id ever arrives without a row it is still money this run is paying and
    // must be stamped — at the amount we can see, which is 0.
    for (const id of invoice.includedQaAssignmentIds) {
      if (!qaAmounts.has(id)) qaAmounts.set(id, 0);
    }
    lines.push({
      cleanerId: entry.payeeId,
      cleanerName: invoice.cleanerName,
      cleanerEmail: invoice.cleanerEmail,
      payeeRole: entry.payeeRole ?? invoice.payeeRole ?? null,
      jobsCount: invoice.rows.length,
      inspectionsCount: invoice.qaInspectionRows.length,
      adjustmentsCount: invoice.includedAdjustmentIds.length,
      paidHours: Number(invoice.hours.toFixed(2)),
      amount: Number(invoice.estimatedPay.toFixed(2)),
    });
  }

  const qaAssignmentAmounts = Array.from(qaAmounts.entries()).map(([id, amount]) => ({
    id,
    amount,
  }));
  return {
    lines: lines.sort((a, b) => a.cleanerName.localeCompare(b.cleanerName)),
    jobIds: Array.from(jobIds),
    adjustmentIds: Array.from(adjustmentIds),
    qaAssignmentIds: qaAssignmentAmounts.map((row) => row.id),
    qaAssignmentAmounts,
    shoppingExpenseAmounts: Array.from(shoppingExpense.entries()).map(([runId, amount]) => ({
      runId,
      amount,
    })),
    shoppingTimeAmounts: Array.from(shoppingTime.entries()).map(([runId, amount]) => ({
      runId,
      amount,
    })),
  };
}

/**
 * Find every payee this run must consider.
 *
 * Four sources, because there are four settlement streams and a payee can hold
 * ANY ONE of them alone:
 *   1. cleaner job assignments in the period (the original query, widened from
 *      `role: CLEANER` to the invoice rail's payee roles);
 *   2. COMPLETED, unsettled QA inspections;
 *   3. APPROVED, unsettled pay adjustments;
 *   4. unsettled shopping — reimbursement or approved time.
 *
 * DISCOVERY MUST BE A SUPERSET OF SELECTION. `getCleanerInvoiceData` selects
 * adjustments with NO date window at all and inspections with only an upper
 * bound (the stamp, never the window, is what prevents double payment), so the
 * discovery queries below use the same bounds. Narrowing them to the period would
 * hide a payee whose only unsettled row was approved/completed earlier — and the
 * money would never be paid by anyone. Discovered payees with nothing payable are
 * dropped later by `payeeHasPayableWork`, so a wide net costs nothing.
 */
async function findPayeeIds(start: Date, end: Date, runId?: string): Promise<string[]> {
  // A row already stamped with THIS run is still ours when recomputing.
  const ownRunClause = runId
    ? { OR: [{ includedInPayrollRunId: null }, { includedInPayrollRunId: runId }] }
    : { includedInPayrollRunId: null };

  const [assignmentPayees, qaRows, adjustmentRows, shoppingRows] = await Promise.all([
    db.user.findMany({
      where: {
        role: { in: INVOICE_PAYEE_ROLES },
        isActive: true,
        jobAssignments: {
          some: {
            removedAt: null,
            job: {
              // Match the completedAt ?? scheduledDate window that the per-cleaner
              // invoice (getCleanerInvoiceData) uses, so selection and totals agree.
              OR: [
                { completedAt: { gte: start, lte: end } },
                { completedAt: null, scheduledDate: { gte: start, lte: end } },
              ],
              status: {
                in: [JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED],
              },
            },
          },
        },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    }),
    db.qaAssignment.findMany({
      where: {
        status: QaAssignmentStatus.COMPLETED,
        assignedToId: { not: null },
        includedInCleanerInvoiceId: null,
        AND: [
          { OR: [{ completedAt: { lte: end } }, { completedAt: null }] },
          ownRunClause,
        ],
      },
      select: { assignedToId: true },
    }),
    db.cleanerPayAdjustment.findMany({
      where: {
        status: PayAdjustmentStatus.APPROVED,
        includedInCleanerInvoiceId: null,
        AND: [ownRunClause],
      },
      select: { cleanerId: true },
    }),
    // 4. unsettled shopping — either stream. A cleaner whose only unpaid work in
    //    the period is a shopping run holds no assignment, no adjustment and no
    //    inspection, so without this query they were never even considered and
    //    the reimbursement was simply never paid by this rail.
    db.shoppingSettlement.findMany({
      where: {
        OR: [
          { AND: [{ includedInCleanerInvoiceId: null }, ownRunClause] },
          {
            AND: [
              { timeIncludedInCleanerInvoiceId: null },
              runId
                ? {
                    OR: [
                      { timeIncludedInPayrollRunId: null },
                      { timeIncludedInPayrollRunId: runId },
                    ],
                  }
                : { timeIncludedInPayrollRunId: null },
            ],
          },
        ],
      },
      select: { shoppingRun: { select: { ownerUserId: true } } },
    }),
  ]);

  const assignmentIds = assignmentPayees.map((row) => row.id);
  const assignmentIdSet = new Set(assignmentIds);
  const candidateExtraIds = Array.from(
    new Set(
      [
        ...qaRows.map((row) => row.assignedToId),
        ...adjustmentRows.map((row) => row.cleanerId),
        ...shoppingRows.map((row) => row.shoppingRun?.ownerUserId ?? null),
      ].filter((id): id is string => Boolean(id) && !assignmentIdSet.has(id as string))
    )
  );
  // Extra payees still have to be an active user in a payee role — this rail must
  // not invent a line for a deactivated account or a non-payee role.
  const extraPayees = candidateExtraIds.length
    ? await db.user.findMany({
        where: {
          id: { in: candidateExtraIds },
          isActive: true,
          role: { in: INVOICE_PAYEE_ROLES },
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return mergePayeeIds(assignmentIds, extraPayees.map((row) => row.id));
}

/**
 * Compute the per-payee pay lines for a period.
 *
 * @param runId  When recomputing an existing run, pass its id so rows already
 *               stamped with THIS run stay included (only rows paid by a DIFFERENT
 *               run are excluded). Omit for a brand-new run.
 */
async function computeLines(
  startDate: string,
  endDate: string,
  runId?: string
): Promise<ComputedLines> {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T23:59:59.999Z`);
  const payeeIds = await findPayeeIds(start, end, runId);

  const entries: PayeeInvoiceEntry[] = [];
  for (const payeeId of payeeIds) {
    const invoice = await getCleanerInvoiceData({
      userId: payeeId,
      startDate,
      endDate,
      showSpentHours: false,
      // Idempotency: never recompute pay for a job/adjustment/inspection already
      // attached to another payroll run (phase4 OR the primary engine — both use
      // the same stamps). includePaidRunId un-excludes THIS run's own rows across
      // all three streams.
      excludePaidJobs: true,
      includePaidRunId: runId,
    });
    entries.push({ payeeId, payeeRole: invoice.payeeRole ?? null, invoice });
  }

  return buildComputedLines(entries);
}

function computeTotals(lines: PayRunLine[]) {
  return {
    cleaners: lines.length,
    jobs: lines.reduce((sum, line) => sum + line.jobsCount, 0),
    paidHours: Number(lines.reduce((sum, line) => sum + line.paidHours, 0).toFixed(2)),
    amount: Number(lines.reduce((sum, line) => sum + line.amount, 0).toFixed(2)),
  };
}

export async function listPayRuns() {
  const store = await readStore();
  return [...store.data.runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getPayRunById(id: string) {
  const rows = await listPayRuns();
  return rows.find((row) => row.id === id) ?? null;
}

export async function createPayRun(input: {
  startDate: string;
  endDate: string;
  name?: string;
  createdByUserId: string;
}) {
  const periodStart = toIsoDateOnly(input.startDate);
  const periodEnd = toIsoDateOnly(input.endDate);
  if (periodStart > periodEnd) throw new Error("Start date must be before end date.");
  const id = randomUUID();
  const [store, computed] = await Promise.all([
    readStore(),
    computeLines(periodStart, periodEnd),
  ]);
  const {
    lines,
    jobIds,
    adjustmentIds,
    qaAssignmentIds,
    qaAssignmentAmounts,
    shoppingExpenseAmounts,
    shoppingTimeAmounts,
  } = computed;
  const now = new Date().toISOString();
  const run: PayRunRecord = {
    id,
    name:
      input.name?.trim().slice(0, 120) ||
      `Pay Run ${periodStart} to ${periodEnd}`,
    periodStart,
    periodEnd,
    status: "DRAFT",
    lines,
    totals: computeTotals(lines),
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
    lockedAt: null,
    lockedByUserId: null,
    paidAt: null,
    paidByUserId: null,
    notes: null,
  };
  const nextData: PayRunStore = { runs: [run, ...store.data.runs].slice(0, 250) };
  // Atomic: stamp EVERY stream whose money is inside `lines` — jobs, approved pay
  // adjustments and completed QA inspections — and persist the run together. Paying
  // a stream without stamping it is a double-pay hole: the primary payroll engine
  // and the payee's next cleaner invoice both select "approved/completed AND
  // unsettled", so an unstamped row is paid a second time.
  //
  // Every updateMany is guarded on the stamp(s) being null, mirroring
  // lib/payroll/engine.ts createPayrollRun, so a concurrent run/invoice can never
  // be robbed of a row it already claimed.
  await db.$transaction(async (tx) => {
    if (jobIds.length > 0) {
      await tx.job.updateMany({
        where: { id: { in: jobIds }, payrollRunId: null },
        data: { payrollRunId: id },
      });
    }
    if (adjustmentIds.length > 0) {
      // CleanerPayAdjustment has no includedInPayrollRunAt column (only the
      // invoice side is timestamped), so the id is the whole stamp.
      await tx.cleanerPayAdjustment.updateMany({
        where: {
          id: { in: adjustmentIds },
          includedInPayrollRunId: null,
          includedInCleanerInvoiceId: null,
        },
        data: { includedInPayrollRunId: id },
      });
    }
    if (qaAssignmentAmounts.length > 0) {
      const stampedAt = new Date();
      // Freeze the amount THIS run paid per inspection alongside the stamp, so a
      // later rate/settings change can never retro-alter history. Row-by-row
      // because the frozen figure differs per inspection.
      for (const row of qaAssignmentAmounts) {
        await tx.qaAssignment.updateMany({
          where: {
            id: row.id,
            includedInPayrollRunId: null,
            includedInCleanerInvoiceId: null,
          },
          data: {
            includedInPayrollRunId: id,
            includedInPayrollRunAt: stampedAt,
            paySettledAmount: row.amount,
          },
        });
      }
    }
    // The FOURTH stream. `estimatedPay` already contains the reimbursement and
    // the approved shopping time, so without these stamps the payee's next
    // cleaner invoice bills both again — the exact hole this rail had.
    await stampShoppingSettlementsForPayrollRun(
      { payrollRunId: id, expense: shoppingExpenseAmounts, time: shoppingTimeAmounts },
      tx
    );
    await writeStore(store.version + 1, nextData, tx);
  });
  return run;
}

/**
 * Release every settlement stamp belonging to `runId`, optionally keeping the rows
 * that are still part of the run (`keep*`). Used by both refresh (reconcile) and
 * delete (release everything).
 *
 * A released inspection also has its FROZEN amount cleared: `paySettledAmount`
 * recorded what THIS run paid, and once the run no longer pays it that figure is
 * a lie that would override the next rail's own computation.
 */
async function releaseRunStamps(
  tx: Prisma.TransactionClient,
  runId: string,
  keep?: {
    jobIds: string[];
    adjustmentIds: string[];
    qaAssignmentIds: string[];
    shoppingExpenseRunIds: string[];
    shoppingTimeRunIds: string[];
  }
) {
  await tx.job.updateMany({
    where: {
      payrollRunId: runId,
      ...(keep && keep.jobIds.length > 0 ? { id: { notIn: keep.jobIds } } : {}),
    },
    data: { payrollRunId: null },
  });
  await tx.cleanerPayAdjustment.updateMany({
    where: {
      includedInPayrollRunId: runId,
      ...(keep && keep.adjustmentIds.length > 0 ? { id: { notIn: keep.adjustmentIds } } : {}),
    },
    data: { includedInPayrollRunId: null },
  });
  await tx.qaAssignment.updateMany({
    where: {
      includedInPayrollRunId: runId,
      ...(keep && keep.qaAssignmentIds.length > 0 ? { id: { notIn: keep.qaAssignmentIds } } : {}),
    },
    data: {
      includedInPayrollRunId: null,
      includedInPayrollRunAt: null,
      paySettledAmount: null,
    },
  });
  await releaseShoppingSettlementsForPayrollRun(
    {
      payrollRunId: runId,
      keepExpenseRunIds: keep?.shoppingExpenseRunIds,
      keepTimeRunIds: keep?.shoppingTimeRunIds,
    },
    tx
  );
}

export async function refreshPayRun(id: string, userId: string) {
  const store = await readStore();
  const index = store.data.runs.findIndex((row) => row.id === id);
  if (index === -1) return null;
  const existing = store.data.runs[index];
  if (existing.status !== "DRAFT") {
    throw new Error("Only draft pay runs can be refreshed.");
  }
  // Recompute including this run's own previously-stamped rows (includePaidRunId)
  // so a refresh re-evaluates them rather than dropping them as "already paid".
  // That option now covers all THREE streams — jobs, adjustments and inspections
  // (see getCleanerInvoiceData); before it reached only jobs, so a refresh
  // silently dropped this run's own adjustments and inspections and then released
  // them, changing what the run was about to pay.
  const {
    lines,
    jobIds,
    adjustmentIds,
    qaAssignmentIds,
    qaAssignmentAmounts,
    shoppingExpenseAmounts,
    shoppingTimeAmounts,
  } = await computeLines(existing.periodStart, existing.periodEnd, existing.id);
  const now = new Date().toISOString();
  const updated: PayRunRecord = {
    ...existing,
    lines,
    totals: computeTotals(lines),
    updatedAt: now,
    notes: existing.notes ?? `Refreshed by ${userId}`,
  };
  const next = [...store.data.runs];
  next[index] = updated;
  // Reconcile all THREE streams in one transaction: release rows stamped with this
  // run that are no longer included, then claim the newly-included ones (guarded on
  // the stamps being null so we never steal a row another run/invoice has already
  // claimed), and persist the run together.
  await db.$transaction(async (tx) => {
    await releaseRunStamps(tx, existing.id, {
      jobIds,
      adjustmentIds,
      qaAssignmentIds,
      shoppingExpenseRunIds: shoppingExpenseAmounts.map((row) => row.runId),
      shoppingTimeRunIds: shoppingTimeAmounts.map((row) => row.runId),
    });
    if (jobIds.length > 0) {
      await tx.job.updateMany({
        where: { id: { in: jobIds }, payrollRunId: null },
        data: { payrollRunId: existing.id },
      });
    }
    if (adjustmentIds.length > 0) {
      await tx.cleanerPayAdjustment.updateMany({
        where: {
          id: { in: adjustmentIds },
          includedInPayrollRunId: null,
          includedInCleanerInvoiceId: null,
        },
        data: { includedInPayrollRunId: existing.id },
      });
    }
    if (qaAssignmentAmounts.length > 0) {
      const stampedAt = new Date();
      for (const row of qaAssignmentAmounts) {
        // Re-freezes the amount for rows this run already held, so the frozen
        // figure always matches the refreshed line.
        await tx.qaAssignment.updateMany({
          where: {
            id: row.id,
            OR: [
              { includedInPayrollRunId: null },
              { includedInPayrollRunId: existing.id },
            ],
            includedInCleanerInvoiceId: null,
          },
          data: {
            includedInPayrollRunId: existing.id,
            includedInPayrollRunAt: stampedAt,
            paySettledAmount: row.amount,
          },
        });
      }
    }
    // Re-claims (and re-freezes) the shopping this run still pays. Its guard is
    // "unstamped OR already mine", so a refresh keeps its own rows without ever
    // stealing one a concurrent invoice/run has claimed in the meantime.
    await stampShoppingSettlementsForPayrollRun(
      {
        payrollRunId: existing.id,
        expense: shoppingExpenseAmounts,
        time: shoppingTimeAmounts,
      },
      tx
    );
    await writeStore(store.version + 1, { runs: next }, tx);
  });
  return updated;
}

/**
 * LOCKED / PAID are metadata only — deliberately no settlement work here.
 *
 * Settlement happens at CREATE time on this rail (the stamps are what make the
 * lines idempotent), and the primary rail does the same: lib/payroll/engine.ts
 * `confirmPayrollRun` / `processPayrollRun` change status and move money but touch
 * no `includedInPayrollRunId` / `paySettledAmount` — those were already written by
 * `createPayrollRun`. Refresh + delete are already blocked outside DRAFT, so a
 * LOCKED/PAID run's stamps can no longer be released.
 */
export async function updatePayRunStatus(input: {
  id: string;
  status: PayRunStatus;
  userId: string;
  notes?: string | null;
}) {
  const store = await readStore();
  const index = store.data.runs.findIndex((row) => row.id === input.id);
  if (index === -1) return null;
  const existing = store.data.runs[index];
  const now = new Date().toISOString();
  const next: PayRunRecord = {
    ...existing,
    status: input.status,
    updatedAt: now,
    notes:
      input.notes !== undefined
        ? input.notes?.trim().slice(0, 2000) || null
        : existing.notes,
    lockedAt: input.status === "LOCKED" ? now : existing.lockedAt,
    lockedByUserId: input.status === "LOCKED" ? input.userId : existing.lockedByUserId,
    paidAt: input.status === "PAID" ? now : existing.paidAt,
    paidByUserId: input.status === "PAID" ? input.userId : existing.paidByUserId,
  };
  const runs = [...store.data.runs];
  runs[index] = next;
  await writeStore(store.version + 1, { runs });
  return next;
}

export async function deletePayRun(id: string) {
  const store = await readStore();
  const existing = store.data.runs.find((row) => row.id === id);
  if (!existing) return false;
  if (existing.status !== "DRAFT") {
    throw new Error("Only draft pay runs can be deleted.");
  }
  const next = store.data.runs.filter((row) => row.id !== id);
  // Release ALL THREE of this run's settlement stamps — jobs, adjustments and
  // inspections — so the work is payable again, and remove the run, atomically.
  // Releasing only jobs left the adjustments and inspections stamped with a run
  // that no longer exists: money marked "already paid" that nothing had paid.
  await db.$transaction(async (tx) => {
    await releaseRunStamps(tx, id);
    await writeStore(store.version + 1, { runs: next }, tx);
  });
  return true;
}
