import { randomUUID } from "crypto";
import { JobStatus, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getCleanerInvoiceData } from "@/lib/cleaner/invoice";
import { readSettingStore, writeSettingStore } from "@/lib/phase4/store";

const PAYRUNS_KEY = "phase4_payruns_v1";

export type PayRunStatus = "DRAFT" | "LOCKED" | "PAID";

export interface PayRunLine {
  cleanerId: string;
  cleanerName: string;
  cleanerEmail: string;
  jobsCount: number;
  paidHours: number;
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
  return {
    cleanerId,
    cleanerName: String(row.cleanerName ?? cleanerEmail).trim() || cleanerEmail,
    cleanerEmail,
    jobsCount: Math.max(0, Number(row.jobsCount ?? 0)),
    paidHours: Math.max(0, Number(row.paidHours ?? 0)),
    amount: Math.max(0, Number(row.amount ?? 0)),
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

interface ComputedLines {
  lines: PayRunLine[];
  // Every job whose pay is captured by these lines. Stamped with the run id so the
  // same job can't be paid again by another phase4 run or by the primary engine.
  jobIds: string[];
}

/**
 * Compute the per-cleaner pay lines for a period.
 *
 * @param runId  When recomputing an existing run, pass its id so jobs already
 *               stamped with THIS run stay included (only jobs paid by a DIFFERENT
 *               run are excluded). Omit for a brand-new run.
 */
async function computeLines(
  startDate: string,
  endDate: string,
  runId?: string
): Promise<ComputedLines> {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T23:59:59.999Z`);
  const cleaners = await db.user.findMany({
    where: {
      role: Role.CLEANER,
      isActive: true,
      jobAssignments: {
        some: {
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
  });

  const lines: PayRunLine[] = [];
  const jobIds = new Set<string>();
  for (const cleaner of cleaners) {
    const invoice = await getCleanerInvoiceData({
      userId: cleaner.id,
      startDate,
      endDate,
      showSpentHours: false,
      // Idempotency: never recompute pay for a job already attached to another
      // payroll run (phase4 OR the primary engine — both stamp Job.payrollRunId).
      excludePaidJobs: true,
      includePaidRunId: runId,
    });
    if (invoice.rows.length === 0) continue;
    for (const row of invoice.rows) jobIds.add(row.jobId);
    lines.push({
      cleanerId: cleaner.id,
      cleanerName: invoice.cleanerName,
      cleanerEmail: invoice.cleanerEmail,
      jobsCount: invoice.rows.length,
      paidHours: Number(invoice.hours.toFixed(2)),
      amount: Number(invoice.estimatedPay.toFixed(2)),
    });
  }

  return {
    lines: lines.sort((a, b) => a.cleanerName.localeCompare(b.cleanerName)),
    jobIds: Array.from(jobIds),
  };
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
  const { lines, jobIds } = computed;
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
  // Atomic: stamp every included job with this run id AND persist the run together.
  // The updateMany guard (payrollRunId: null) mirrors the primary engine so a
  // concurrent run can't double-stamp; the same field also makes the primary
  // engine's excludePaidJobs filter skip these jobs.
  await db.$transaction(async (tx) => {
    if (jobIds.length > 0) {
      await tx.job.updateMany({
        where: { id: { in: jobIds }, payrollRunId: null },
        data: { payrollRunId: id },
      });
    }
    await writeStore(store.version + 1, nextData, tx);
  });
  return run;
}

export async function refreshPayRun(id: string, userId: string) {
  const store = await readStore();
  const index = store.data.runs.findIndex((row) => row.id === id);
  if (index === -1) return null;
  const existing = store.data.runs[index];
  if (existing.status !== "DRAFT") {
    throw new Error("Only draft pay runs can be refreshed.");
  }
  // Recompute including this run's own previously-stamped jobs (includePaidRunId)
  // so a refresh re-evaluates them rather than dropping them as "already paid".
  const { lines, jobIds } = await computeLines(
    existing.periodStart,
    existing.periodEnd,
    existing.id
  );
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
  // Reconcile stamps in one transaction: release jobs no longer in this run, claim
  // newly-included jobs (guarded on payrollRunId: null so we never steal a job that
  // another run has already claimed), and persist the run together.
  await db.$transaction(async (tx) => {
    await tx.job.updateMany({
      where: { payrollRunId: existing.id, id: { notIn: jobIds } },
      data: { payrollRunId: null },
    });
    if (jobIds.length > 0) {
      await tx.job.updateMany({
        where: { id: { in: jobIds }, payrollRunId: null },
        data: { payrollRunId: existing.id },
      });
    }
    await writeStore(store.version + 1, { runs: next }, tx);
  });
  return updated;
}

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
  // Release this run's job stamps so the jobs are payable again, and remove the
  // run, atomically.
  await db.$transaction(async (tx) => {
    await tx.job.updateMany({
      where: { payrollRunId: id },
      data: { payrollRunId: null },
    });
    await writeStore(store.version + 1, { runs: next }, tx);
  });
  return true;
}
