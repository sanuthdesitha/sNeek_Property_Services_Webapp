import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { createJobSchema } from "@/lib/validations/job";
import type { z } from "zod";
import { applyJobTimingRules, serializeJobInternalNotes } from "./meta";
import { classifyPriorityFromTimingRule } from "./priority";
import { reserveJobNumber } from "./job-number";
import { ensureServiceSiteProperty } from "./service-site";
import { attachPendingCarryForwardTasksToJob } from "@/lib/job-tasks/service";
import { assignPreferredCleanerIfAvailable } from "./preferred-cleaner";
import { sendLifecycleEmail } from "@/lib/notifications/lifecycle";

/**
 * The admin job-create service: what `POST /api/admin/jobs` has always done,
 * moved here unchanged so the CSV import creates jobs through the same code.
 *
 * Steps: timing rules and priority, a reserved job number, the service-site
 * property when no property is given, the job row, then the same follow-ups
 * (carry-forward tasks, preferred cleaner, the client's booking confirmation
 * when switched on).
 *
 * `receipt` (CSV import only) makes the create idempotent per import row:
 * the job and an AuditLog receipt are written in ONE transaction under an
 * advisory lock on the receipt key, and a retry that finds the receipt returns
 * the job it created instead of creating another. Follow-ups run once, after
 * the first commit.
 */
export type CreateJobInput = z.infer<typeof createJobSchema>;
export type ImportReceipt = { key: string; userId: string; detail: Record<string, unknown> };
export type AdminCreateResult = { jobId: string; jobNumber: string | null; replayed: boolean };

export const IMPORT_RECEIPT_ACTION = "JOB_CSV_IMPORT_ROW";

type TimingRuleInput = { enabled?: boolean; preset?: "none" | "11:00" | "12:30" | "custom"; time?: string } | undefined;
type Client = typeof db | Prisma.TransactionClient;

function normalizeRule(rule: TimingRuleInput) {
  if (!rule) return undefined;
  return { enabled: rule.enabled === true, preset: rule.preset ?? "none", time: rule.time };
}

async function insertJob(client: Client, body: CreateJobInput) {
  const {
    propertyId, clientId, startTime, dueTime, internalNotes, isDraft, tags, attachments, transportAllowances,
    earlyCheckin, lateCheckout, serviceSite, serviceContext, reservationContext, ...rest
  } = body;
  const normalizedEarlyCheckin = normalizeRule(earlyCheckin) ?? { enabled: false, preset: "none" as const };
  const normalizedLateCheckout = normalizeRule(lateCheckout) ?? { enabled: false, preset: "none" as const };
  const timing = applyJobTimingRules({ startTime, dueTime, earlyCheckin: normalizedEarlyCheckin, lateCheckout: normalizedLateCheckout });
  const priority = classifyPriorityFromTimingRule(normalizedEarlyCheckin);
  const jobNumber = await reserveJobNumber(client as Parameters<typeof reserveJobNumber>[0]);
  const resolvedPropertyId = propertyId ?? (
    await ensureServiceSiteProperty(client as Parameters<typeof ensureServiceSiteProperty>[0], {
      clientId,
      jobType: body.jobType,
      // On CREATE, null and undefined both mean "not set" — the schema
      // accepts null so an UPDATE can clear the field.
      estimatedHours: body.estimatedHours ?? undefined,
      serviceSite: serviceSite!,
      serviceContext,
    })
  ).id;
  return client.job.create({
    data: {
      ...rest,
      propertyId: resolvedPropertyId,
      jobNumber,
      startTime: timing.startTime,
      dueTime: timing.dueTime,
      priorityBucket: priority.priorityBucket,
      priorityReason: priority.priorityReason,
      sameDayCheckin: priority.sameDayCheckin,
      sameDayCheckinTime: priority.sameDayCheckinTime,
      scheduledDate: new Date(body.scheduledDate),
      internalNotes: serializeJobInternalNotes({
        internalNoteText: internalNotes ?? "",
        isDraft,
        tags,
        attachments,
        transportAllowances,
        earlyCheckin: normalizedEarlyCheckin,
        lateCheckout: normalizedLateCheckout,
        serviceContext,
        reservationContext,
      }),
    },
    include: { property: true },
  });
}

type CreatedJob = Awaited<ReturnType<typeof insertJob>>;

async function afterCreate(job: CreatedJob): Promise<void> {
  await attachPendingCarryForwardTasksToJob({ jobId: job.id, propertyId: job.propertyId, scheduledDate: job.scheduledDate, startTime: job.startTime });
  await assignPreferredCleanerIfAvailable({ jobId: job.id, propertyId: job.propertyId, jobType: job.jobType });
  // Confirm the booking with the client for a real (non-rework) job that hangs
  // off a client via its property. Best-effort auto send (gated + never throws).
  if (!job.isRework && job.property?.clientId) {
    const scheduleText = job.scheduledDate
      ? new Date(job.scheduledDate).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", year: "numeric" })
      : undefined;
    await sendLifecycleEmail({ jobId: job.id, stage: "BOOKING_CONFIRMED", mode: "auto", extra: { scheduleText } }).catch(() => {});
  }
}

/** The route's create: returns the created job (with its property) as before. */
export async function createAdminJob(body: CreateJobInput): Promise<CreatedJob> {
  const job = await insertJob(db, body);
  await afterCreate(job);
  return job;
}

/** Idempotent create for one import row (see the receipt note above). */
export async function createAdminJobOnce(body: CreateJobInput, receipt: ImportReceipt): Promise<AdminCreateResult> {
  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${receipt.key}, 0))`;
    const existing = await tx.auditLog.findFirst({
      where: { action: IMPORT_RECEIPT_ACTION, entity: "JobImport", entityId: receipt.key },
      select: { jobId: true },
    });
    if (existing?.jobId) {
      const job = await tx.job.findUnique({ where: { id: existing.jobId }, select: { id: true, jobNumber: true } });
      return { kind: "replayed" as const, jobId: existing.jobId, jobNumber: job?.jobNumber ?? null };
    }
    const job = await insertJob(tx, body);
    await tx.auditLog.create({
      data: {
        userId: receipt.userId, jobId: job.id, action: IMPORT_RECEIPT_ACTION, entity: "JobImport", entityId: receipt.key,
        after: receipt.detail as Prisma.InputJsonValue,
      },
    });
    return { kind: "created" as const, job };
  });
  if (outcome.kind === "replayed") return { jobId: outcome.jobId, jobNumber: outcome.jobNumber, replayed: true };
  await afterCreate(outcome.job);
  return { jobId: outcome.job.id, jobNumber: outcome.job.jobNumber, replayed: false };
}
