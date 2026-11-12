import "server-only";
/**
 * "Cancel job" and "Restore" (Wave E, 2026-11). The rules are in
 * ./cancel-rules (pure); the financial refusals and the writes are here, in one
 * transaction with the job row locked.
 *
 * What a cancel does:
 *  - status CANCELLED with cancelledAt / cancelledById / cancelReason and the
 *    status it was cancelled from;
 *  - releases the active cleaner assignments (removedAt = the cancel time; the
 *    rows, their rate snapshots and responses are kept, so Restore can put them
 *    back); this also takes the job off every cleaner list and app, which all
 *    scope by an active assignment;
 *  - cancels QA inspections not yet started (OPEN / ASSIGNED);
 *  - keeps time logs, photos, forms, the laundry task and everything else as
 *    it is (a laundry task is reported back for the office to review);
 *  - notifies the released cleaners in their inbox (./cancel-notice);
 *  - writes JOB_CANCELLED to the audit log (who, the acting admin when
 *    "testing as", reason, released assignments).
 * It is refused while the job is on an invoice that is not void (draft
 * included), in a payroll run, paid through a cleaner invoice or on one not
 * void/changes-requested, has pay requests pending or approved, has settled QA
 * pay or an inspection in progress, or a cleaner's clock is running.
 * No client notice is sent automatically.
 */
import { JobStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { FINANCIAL_RECORD_LINE_WHERE } from "@/lib/invoicing/invoiced-job-rule";
import { derivePreStartJobStatus } from "./assignment-workflow";
import { cancelRefusal, restoreRefusal } from "./cancel-rules";

export class JobCancelError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409, readonly code?: string) {
    super(message);
    this.name = "JobCancelError";
  }
}

export type CancelActor = { id: string; isAdmin: boolean; impersonatedBy?: string | null };

export type ReleasedAssignment = { userId: string; isPrimary: boolean; responseStatus: string };

export type CancelResult = {
  jobId: string;
  jobNumber: string;
  propertyName: string;
  scheduledDate: Date;
  previousStatus: JobStatus;
  cancelledAt: Date;
  released: Array<ReleasedAssignment & { name: string | null; email: string | null; role: string; isActive: boolean }>;
  followUps: string[];
};

type Tx = Prisma.TransactionClient;

/** Every reason the money already attached to this job forbids cancelling it. */
async function financialRefusals(tx: Tx, jobId: string): Promise<string[]> {
  const [job, claim, adjustments, settledQa, inspecting, openClock] = await Promise.all([
    tx.job.findUnique({
      where: { id: jobId },
      select: {
        payrollRunId: true,
        cleanerPaidAt: true,
        invoiceLines: { where: FINANCIAL_RECORD_LINE_WHERE, take: 1, select: { invoice: { select: { invoiceNumber: true, status: true } } } },
      },
    }),
    tx.cleanerInvoiceSubmission.findFirst({
      where: { status: { notIn: ["VOID", "CHANGES_REQUESTED"] }, lineData: { path: ["jobIds"], array_contains: [jobId] } },
      select: { id: true, status: true },
    }),
    tx.cleanerPayAdjustment.count({ where: { jobId, status: { in: ["PENDING", "APPROVED"] } } }),
    tx.qaAssignment.count({ where: { jobId, OR: [{ includedInPayrollRunId: { not: null } }, { includedInCleanerInvoiceId: { not: null } }, { paySettledAmount: { not: null } }] } }),
    tx.qaAssignment.count({ where: { jobId, status: "IN_PROGRESS" } }),
    tx.timeLog.count({ where: { jobId, stoppedAt: null } }),
  ]);
  const reasons: string[] = [];
  const line = job?.invoiceLines[0];
  if (line) reasons.push(`It is on invoice ${line.invoice.invoiceNumber} (${String(line.invoice.status).toLowerCase().replace(/_/g, " ")}). Remove it from that invoice or void the invoice first.`);
  if (job?.payrollRunId) reasons.push("Its cleaner pay is in a payroll run.");
  if (job?.cleanerPaidAt) reasons.push("Its cleaner has been paid for it through a cleaner invoice.");
  if (claim) reasons.push(`It is on a cleaner invoice (${String(claim.status).toLowerCase().replace(/_/g, " ")}).`);
  if (adjustments > 0) reasons.push(`It has ${adjustments} pay request${adjustments === 1 ? "" : "s"} pending or approved. Decide or reject them first.`);
  if (settledQa > 0) reasons.push("Its QA inspection pay is settled or in a pay run.");
  if (inspecting > 0) reasons.push("A QA inspection of it is in progress.");
  if (openClock > 0) reasons.push("A cleaner's clock is running on it. Stop the clock first.");
  return reasons;
}

export async function cancelJob(jobId: string, input: { reason: string; expectedUpdatedAt?: string }, actor: CancelActor, now: Date = new Date()): Promise<CancelResult> {
  const reason = input.reason.trim();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${jobId} FOR UPDATE`;
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: {
        id: true, jobNumber: true, status: true, scheduledDate: true, updatedAt: true,
        property: { select: { name: true } },
        laundryTask: { select: { status: true } },
        assignments: {
          where: { removedAt: null },
          select: { id: true, userId: true, isPrimary: true, responseStatus: true, user: { select: { name: true, email: true, role: true, isActive: true } } },
        },
      },
    });
    if (!job) throw new JobCancelError("Job not found.", 404);
    if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== job.updatedAt.getTime()) {
      throw new JobCancelError("This job changed. Reload before cancelling.", 409, "STALE");
    }
    const refusal = cancelRefusal({ status: job.status, actorIsAdmin: actor.isAdmin, reason });
    if (refusal) throw new JobCancelError(refusal, refusal.startsWith("Only an administrator") ? 403 : 409, "RULE");
    const money = await financialRefusals(tx, jobId);
    if (money.length > 0) throw new JobCancelError(`This job cannot be cancelled. ${money.join(" ")}`, 409, "FINANCIAL");

    const updated = await tx.job.updateMany({
      where: { id: jobId, status: job.status, updatedAt: job.updatedAt },
      data: { status: JobStatus.CANCELLED, cancelledAt: now, cancelledById: actor.id, cancelReason: reason, cancelledFromStatus: job.status },
    });
    if (updated.count !== 1) throw new JobCancelError("This job changed. Reload before cancelling.", 409, "STALE");
    if (job.assignments.length > 0) {
      await tx.jobAssignment.updateMany({ where: { id: { in: job.assignments.map((row) => row.id) } }, data: { removedAt: now, isPrimary: false } });
    }
    await tx.qaAssignment.updateMany({ where: { jobId, status: { in: ["OPEN", "ASSIGNED"] } }, data: { status: "CANCELLED" } });
    const released = job.assignments.map((row) => ({ userId: row.userId, isPrimary: row.isPrimary, responseStatus: String(row.responseStatus) }));
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        jobId,
        action: "JOB_CANCELLED",
        entity: "Job",
        entityId: jobId,
        before: { status: job.status },
        after: { status: JobStatus.CANCELLED, reason, releasedAssignments: released, impersonatedBy: actor.impersonatedBy ?? null } as Prisma.InputJsonValue,
      },
    });
    const followUps: string[] = [];
    const openTasks = await tx.jobTask.count({ where: { jobId, executionStatus: "OPEN" } });
    if (openTasks > 0) followUps.push(`${openTasks} open task${openTasks === 1 ? " is" : "s are"} on this job and stay${openTasks === 1 ? "s" : ""} with it. Move ${openTasks === 1 ? "it" : "them"} to another job if the work is still wanted.`);
    if (job.laundryTask) followUps.push(`This job has a laundry task (${String(job.laundryTask.status).toLowerCase().replace(/_/g, " ")}). Review it on the Laundry page; it was not changed.`);
    followUps.push("The client is not told automatically. Use the job's Messages tab if they should know.");
    return {
      jobId,
      jobNumber: job.jobNumber,
      propertyName: job.property?.name ?? "the property",
      scheduledDate: job.scheduledDate,
      previousStatus: job.status,
      cancelledAt: now,
      released: job.assignments.map((row) => ({ userId: row.userId, isPrimary: row.isPrimary, responseStatus: String(row.responseStatus), name: row.user.name, email: row.user.email, role: String(row.user.role), isActive: row.user.isActive })),
      followUps,
    };
  });
}

export type RestoreResult = {
  jobId: string;
  jobNumber: string;
  propertyName: string;
  scheduledDate: Date;
  status: JobStatus;
  restoredUserIds: string[];
  notRestored: Array<{ userId: string; reason: string }>;
};

/** The assignments released by the job's latest cancellation (from its audit row). */
export async function releasedAssignmentsFor(tx: Pick<Tx, "auditLog">, jobId: string): Promise<ReleasedAssignment[]> {
  const row = await tx.auditLog.findFirst({ where: { jobId, entity: "Job", action: "JOB_CANCELLED" }, orderBy: { createdAt: "desc" }, select: { after: true } });
  const after = (row?.after ?? null) as { releasedAssignments?: unknown } | null;
  if (!after || !Array.isArray(after.releasedAssignments)) return [];
  return after.releasedAssignments.flatMap((entry): ReleasedAssignment[] => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    return typeof value.userId === "string" ? [{ userId: value.userId, isPrimary: value.isPrimary === true, responseStatus: String(value.responseStatus ?? "PENDING") }] : [];
  });
}

/**
 * Put a cancelled job back to the unstarted status it was cancelled from, with
 * the assignments the cancel released (active cleaners only). `blockedUserIds`
 * are cleaners the caller's slot check refused and the office chose not to
 * override; they stay released.
 */
export async function restoreJob(jobId: string, actor: CancelActor, options: { skipUserIds?: readonly string[]; expectedUpdatedAt?: string } = {}, now: Date = new Date()): Promise<RestoreResult> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Job" WHERE id = ${jobId} FOR UPDATE`;
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: { id: true, jobNumber: true, status: true, cancelledFromStatus: true, scheduledDate: true, updatedAt: true, property: { select: { name: true } } },
    });
    if (!job) throw new JobCancelError("Job not found.", 404);
    if (options.expectedUpdatedAt && new Date(options.expectedUpdatedAt).getTime() !== job.updatedAt.getTime()) {
      throw new JobCancelError("This job changed. Reload before restoring.", 409, "STALE");
    }
    const refusal = restoreRefusal(job);
    if (refusal) throw new JobCancelError(refusal, 409, "RULE");
    const released = await releasedAssignmentsFor(tx, jobId);
    const skip = new Set(options.skipUserIds ?? []);
    const people = released.length
      ? await tx.user.findMany({ where: { id: { in: released.map((row) => row.userId) } }, select: { id: true, isActive: true, role: true, extraRoles: { select: { role: true } } } })
      : [];
    const byId = new Map(people.map((person) => [person.id, person]));
    const notRestored: RestoreResult["notRestored"] = [];
    const restoring: ReleasedAssignment[] = [];
    for (const row of released) {
      const person = byId.get(row.userId);
      const isCleaner = person && (person.role === "CLEANER" || person.extraRoles.some((extra) => extra.role === "CLEANER"));
      if (!person?.isActive || !isCleaner) notRestored.push({ userId: row.userId, reason: "No longer an active cleaner." });
      else if (skip.has(row.userId)) notRestored.push({ userId: row.userId, reason: "Left off by the office (slot check)." });
      else restoring.push(row);
    }
    for (const row of restoring) {
      await tx.jobAssignment.updateMany({ where: { jobId, userId: row.userId }, data: { removedAt: null, isPrimary: row.isPrimary } });
    }
    if (restoring.length > 0 && !restoring.some((row) => row.isPrimary)) {
      await tx.jobAssignment.updateMany({ where: { jobId, userId: restoring[0].userId }, data: { isPrimary: true } });
    }
    const assignments = await tx.jobAssignment.findMany({ where: { jobId, removedAt: null }, select: { removedAt: true, responseStatus: true } });
    const status = derivePreStartJobStatus(job.cancelledFromStatus as JobStatus, assignments);
    const updated = await tx.job.updateMany({ where: { id: jobId, status: JobStatus.CANCELLED, updatedAt: job.updatedAt }, data: { status } });
    if (updated.count !== 1) throw new JobCancelError("This job changed. Reload before restoring.", 409, "STALE");
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        jobId,
        action: "JOB_CANCEL_RESTORED",
        entity: "Job",
        entityId: jobId,
        before: { status: JobStatus.CANCELLED },
        after: { status, restoredUserIds: restoring.map((row) => row.userId), notRestored, restoredAt: now.toISOString(), impersonatedBy: actor.impersonatedBy ?? null } as Prisma.InputJsonValue,
      },
    });
    return {
      jobId,
      jobNumber: job.jobNumber,
      propertyName: job.property?.name ?? "the property",
      scheduledDate: job.scheduledDate,
      status,
      restoredUserIds: restoring.map((row) => row.userId),
      notRestored,
    };
  });
}
