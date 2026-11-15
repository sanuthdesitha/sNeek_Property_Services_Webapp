import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { createJobSchema } from "@/lib/validations/job";
import type { z } from "zod";
import { applyJobTimingRules, parseJobInternalNotes, serializeJobInternalNotes } from "./meta";
import { classifyPriorityFromTimingRule } from "./priority";
import { reserveJobNumber } from "./job-number";
import { ensureServiceSiteProperty } from "./service-site";
import { attachPendingCarryForwardTasksToJob, syncAdminJobTasks } from "@/lib/job-tasks/service";
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
 * the first commit. The New job page uses the same receipt with its own
 * action (`NEW_JOB_RECEIPT_ACTION`), keyed by the request's idempotency key.
 *
 * `options` (New job page, 2026-11): three per-job choices the office makes
 * on screen. Left out, every create behaves exactly as it always has:
 * - `skipPreferredCleaner`: "Leave unassigned and skip the preferred cleaner".
 * - `sendBookingConfirmation: false`: "Do not send for this job" (recorded in
 *   the audit log; the email pipeline itself is untouched).
 * - `actor`: who pressed Create. Needed only for special tasks (a JobTask
 *   records who requested it) and notices (stamped with the author's name),
 *   the same stamps the job page's edit writes.
 */
export type CreateJobInput = z.infer<typeof createJobSchema>;
export type ImportReceipt = {
  key: string;
  userId: string;
  detail: Record<string, unknown>;
  /** Defaults to the CSV import's action and entity. */
  action?: string;
  entity?: string;
};
export type CreateJobOptions = {
  actor?: { userId: string; name: string | null };
  skipPreferredCleaner?: boolean;
  sendBookingConfirmation?: boolean;
};

/** What the follow-ups did, in words the screen can repeat without overstating. */
export type PreferredCleanerOutcome =
  | { outcome: "offered"; cleanerId: string }
  | { outcome: "skipped_by_office" }
  | { outcome: "none"; reason: "no_preferred_cleaner" | "preferred_cleaner_inactive" };
export type BookingEmailOutcome =
  | { outcome: "accepted"; recipients: string[] }
  | { outcome: "not_sent"; reason: string }
  | { outcome: "switched_off" }
  | { outcome: "not_applicable" };
export type CreateFollowUps = {
  carryForwardAttached: number;
  preferredCleaner: PreferredCleanerOutcome;
  bookingEmail: BookingEmailOutcome;
};
export type AdminCreateResult = {
  jobId: string;
  jobNumber: string | null;
  replayed: boolean;
  /** Only on a fresh create (a replay ran its follow-ups the first time). */
  followUps?: CreateFollowUps;
  /** A replay whose request body differs from the first attempt's. */
  changedSinceFirstAttempt?: boolean;
};

export const IMPORT_RECEIPT_ACTION = "JOB_CSV_IMPORT_ROW";
export const NEW_JOB_RECEIPT_ACTION = "JOB_CREATE_REQUEST";
export const NEW_JOB_RECEIPT_ENTITY = "JobCreateRequest";
export const BOOKING_CONFIRMATION_SKIPPED_ACTION = "JOB_BOOKING_CONFIRMATION_SKIPPED";

type TimingRuleInput = { enabled?: boolean; preset?: "none" | "11:00" | "12:30" | "custom"; time?: string } | undefined;
type Client = typeof db | Prisma.TransactionClient;

function normalizeRule(rule: TimingRuleInput) {
  if (!rule) return undefined;
  return { enabled: rule.enabled === true, preset: rule.preset ?? "none", time: rule.time };
}

type NoticeInput = NonNullable<CreateJobInput["notices"]>[number];

/** Notices are stamped like the job page's edit stamps a new notice. */
function stampNotices(notices: NoticeInput[] | undefined, actorName: string | null | undefined) {
  if (!notices?.length) return undefined;
  const now = new Date().toISOString();
  return notices.map((notice, index) => ({
    id: notice.id?.trim() || `notice-${Date.now()}-${index}`,
    body: notice.body.trim(),
    urgency: notice.urgency === "IMPORTANT" ? ("IMPORTANT" as const) : ("INFO" as const),
    authorName: actorName ?? undefined,
    createdAt: now,
    imageUrls: notice.imageUrls,
  }));
}

async function insertJob(client: Client, body: CreateJobInput, options: CreateJobOptions = {}) {
  const {
    propertyId, clientId, startTime, dueTime, internalNotes, isDraft, tags, attachments, transportAllowances,
    earlyCheckin, lateCheckout, serviceSite, serviceContext, reservationContext,
    // Not Job columns: they live in the notes meta (and special tasks also as
    // JobTasks, below). Before 2026-11 nothing sent them on create.
    specialRequestTasks, notices, ...rest
  } = body;
  if (specialRequestTasks?.length && !options.actor) {
    throw new Error("Special tasks need the person creating the job.");
  }
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
  const created = await client.job.create({
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
        notices: stampNotices(notices, options.actor?.name),
      }),
    },
    include: { property: true },
  });
  if (!specialRequestTasks?.length || !options.actor) return created;
  // Special tasks execute through JobTasks, exactly as the job page's edit
  // creates them; the meta keeps the canonical ids the tasks were given.
  const tasks = await syncAdminJobTasks({
    jobId: created.id, propertyId: created.propertyId, clientId: created.property?.clientId ?? null,
    actorUserId: options.actor.userId, tasks: specialRequestTasks, database: client as Prisma.TransactionClient,
  });
  const meta = parseJobInternalNotes(created.internalNotes);
  return client.job.update({
    where: { id: created.id },
    data: {
      internalNotes: serializeJobInternalNotes({
        ...meta,
        specialRequestTasks: tasks.canonicalTasks.map((task) => ({
          id: task.id!, title: task.title, description: task.description ?? undefined,
          allowNotApplicable: task.allowNotApplicable === true,
          requiresPhoto: task.requiresPhoto === true, requiresNote: task.requiresNote === true,
        })),
      }),
    },
    include: { property: true },
  });
}

type CreatedJob = Awaited<ReturnType<typeof insertJob>>;

function bookingScheduleText(job: CreatedJob): string | undefined {
  return job.scheduledDate
    ? new Date(job.scheduledDate).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : undefined;
}

async function confirmBooking(job: CreatedJob, options: CreateJobOptions): Promise<BookingEmailOutcome> {
  if (job.isRework || !job.property?.clientId) return { outcome: "not_applicable" };
  if (options.sendBookingConfirmation === false) {
    // The route always passes the actor; a caller without one records nothing.
    if (options.actor) await db.auditLog.create({
      data: {
        userId: options.actor.userId, jobId: job.id, action: BOOKING_CONFIRMATION_SKIPPED_ACTION, entity: "Job", entityId: job.id,
        after: { stage: "BOOKING_CONFIRMED", reason: "Switched off for this job when it was created" } as Prisma.InputJsonValue,
      },
    }).catch(() => {});
    return { outcome: "switched_off" };
  }
  // Best-effort auto send (gated + never throws), exactly as before.
  const result = await sendLifecycleEmail({ jobId: job.id, stage: "BOOKING_CONFIRMED", mode: "auto", extra: { scheduleText: bookingScheduleText(job) } })
    .catch(() => ({ sent: false, recipients: [] as string[], skipped: "error" }));
  if (result?.sent) return { outcome: "accepted", recipients: result.recipients };
  return { outcome: "not_sent", reason: result?.skipped ?? "not-accepted" };
}

async function afterCreate(job: CreatedJob, options: CreateJobOptions = {}): Promise<CreateFollowUps> {
  const carry = await attachPendingCarryForwardTasksToJob({ jobId: job.id, propertyId: job.propertyId, scheduledDate: job.scheduledDate, startTime: job.startTime });
  let preferredCleaner: PreferredCleanerOutcome;
  if (options.skipPreferredCleaner) {
    preferredCleaner = { outcome: "skipped_by_office" };
  } else {
    const preferred = await assignPreferredCleanerIfAvailable({ jobId: job.id, propertyId: job.propertyId, jobType: job.jobType });
    if (preferred?.assigned && "cleanerId" in preferred && preferred.cleanerId) {
      preferredCleaner = { outcome: "offered", cleanerId: preferred.cleanerId };
    } else {
      const reason = preferred && "reason" in preferred && preferred.reason ? preferred.reason : "no_preferred_cleaner";
      preferredCleaner = { outcome: "none", reason };
    }
  }
  // Confirm the booking with the client for a real (non-rework) job that hangs
  // off a client via its property.
  const bookingEmail = await confirmBooking(job, options);
  return { carryForwardAttached: carry?.attached ?? 0, preferredCleaner, bookingEmail };
}

/** The route's create: returns the created job (with its property) as before. */
export async function createAdminJob(body: CreateJobInput, options: CreateJobOptions = {}): Promise<CreatedJob> {
  return (await createAdminJobWithFollowUps(body, options)).job;
}

/** The same create, also reporting what the follow-ups did. */
export async function createAdminJobWithFollowUps(body: CreateJobInput, options: CreateJobOptions = {}): Promise<{ job: CreatedJob; followUps: CreateFollowUps }> {
  const job = await insertJob(db, body, options);
  const followUps = await afterCreate(job, options);
  return { job, followUps };
}

function receiptBodyHash(detail: unknown): string | null {
  const value = detail && typeof detail === "object" ? (detail as Record<string, unknown>).bodyHash : null;
  return typeof value === "string" ? value : null;
}

/** Idempotent create for one import row or one New job request (see the receipt note above). */
export async function createAdminJobOnce(body: CreateJobInput, receipt: ImportReceipt, options: CreateJobOptions = {}): Promise<AdminCreateResult> {
  const action = receipt.action ?? IMPORT_RECEIPT_ACTION;
  const entity = receipt.entity ?? "JobImport";
  const outcome = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${receipt.key}, 0))`;
    const existing = await tx.auditLog.findFirst({
      where: { action, entity, entityId: receipt.key },
      select: { jobId: true, after: true },
    });
    if (existing?.jobId) {
      const job = await tx.job.findUnique({ where: { id: existing.jobId }, select: { id: true, jobNumber: true } });
      const firstHash = receiptBodyHash(existing.after);
      const thisHash = receiptBodyHash(receipt.detail);
      const changed = Boolean(firstHash && thisHash && firstHash !== thisHash);
      return { kind: "replayed" as const, jobId: existing.jobId, jobNumber: job?.jobNumber ?? null, changed };
    }
    const job = await insertJob(tx, body, options);
    await tx.auditLog.create({
      data: {
        userId: receipt.userId, jobId: job.id, action, entity, entityId: receipt.key,
        after: receipt.detail as Prisma.InputJsonValue,
      },
    });
    return { kind: "created" as const, job };
  });
  if (outcome.kind === "replayed") {
    return { jobId: outcome.jobId, jobNumber: outcome.jobNumber, replayed: true, ...(outcome.changed ? { changedSinceFirstAttempt: true } : {}) };
  }
  const followUps = await afterCreate(outcome.job, options);
  return { jobId: outcome.job.id, jobNumber: outcome.job.jobNumber, replayed: false, followUps };
}
