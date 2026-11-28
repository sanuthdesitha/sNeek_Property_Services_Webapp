import "server-only";
/**
 * "Looks unused — ask the office" (2026-11-28), server side.
 *
 * askUnusedCheck    the assigned cleaner asks (one open question per job;
 *                   a retry with the same request key returns the same row).
 * answerUnusedCheck an ADMIN or OPS_MANAGER answers once.
 *
 * Both write an audit row on the job (its History) and queue inbox notices
 * through the notification intent pipeline with explicit transports: the
 * inbox row, plus the phone push of its category (office: approvals, as the
 * cleaner's other requests; cleaner: jobs, as other request decisions).
 * Never email or SMS. Queued is not delivered: the callers report the inbox
 * state the pipeline returns.
 *
 * The answer never changes the job's status, schedule, rate or pay.
 */
import { Prisma, Role, type JobUnusedCheck } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueueNotificationIntent } from "@/lib/notifications/intent-store";
import { authorizeEntityRecipient } from "@/lib/notifications/recipient-scopes";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { FOREIGN_UPLOAD_MESSAGE, uploadKeysNotOwnedBy } from "@/lib/uploads/ownership";
import {
  UNUSED_CHECK_DECISIONS,
  UNUSED_CHECK_DECISION_LABELS,
  UNUSED_CHECK_DECISION_GUIDANCE,
  UNUSED_CHECK_NOTE_MAX,
  UNUSED_CHECK_PHOTO_MAX,
  unusedCheckEligibility,
  type UnusedCheckDecision,
  type UnusedCheckView,
} from "./unused-check-rules";

type Tx = Prisma.TransactionClient;

export const UNUSED_CHECK_TYPE_KEY = "job.unused_check";
export const UNUSED_CHECK_ASKED_EVENT = "job_unused_check.asked";
export const UNUSED_CHECK_ANSWERED_EVENT = "job_unused_check.answered";

export class UnusedCheckError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

export const askUnusedCheckInput = z.object({
  requestKey: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
  note: z.string().trim().max(UNUSED_CHECK_NOTE_MAX).optional().nullable(),
  photoKeys: z.array(z.string().trim().min(1).max(500)).max(UNUSED_CHECK_PHOTO_MAX).optional(),
});
export type AskUnusedCheckInput = z.infer<typeof askUnusedCheckInput>;

export const answerUnusedCheckInput = z.object({
  decision: z.enum(UNUSED_CHECK_DECISIONS),
  note: z.string().trim().max(UNUSED_CHECK_NOTE_MAX).optional().nullable(),
});
export type AnswerUnusedCheckInput = z.infer<typeof answerUnusedCheckInput>;

export type UnusedCheckActor = { id: string; role: Role };

export type AskOutcome = "CREATED" | "REPLAYED" | "ALREADY_OPEN";
export type AnswerOutcome = "ANSWERED" | "REPLAYED";

export type UnusedCheckWriteResult<Outcome> = {
  outcome: Outcome;
  check: JobUnusedCheck;
  /** Intents queued by this call (none on a replay). */
  intentIds: string[];
};

function lockKey(jobId: string): string {
  return `job-unused-check:${jobId}`;
}

async function lockJob(tx: Tx, jobId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(jobId)}))`;
}

type JobContext = { id: string; jobNumber: string; propertyName: string };

async function readJobContext(tx: Tx, jobId: string): Promise<JobContext | null> {
  const job = await tx.job.findUnique({ where: { id: jobId }, select: { id: true, jobNumber: true, property: { select: { name: true } } } });
  if (!job) return null;
  return { id: job.id, jobNumber: job.jobNumber, propertyName: job.property?.name ?? "the property" };
}

/** Office people who may see this job (ADMIN, OPS_MANAGER with the Jobs pack), checked again at dispatch. */
async function officeRecipients(tx: Tx, jobId: string): Promise<Array<{ userId: string; role: Role }>> {
  const candidates = await tx.user.findMany({
    where: { isActive: true, role: { in: [Role.ADMIN, Role.OPS_MANAGER] } },
    select: { id: true, role: true },
    orderBy: { id: "asc" },
  });
  const allowed: Array<{ userId: string; role: Role }> = [];
  for (const candidate of candidates) {
    const authorization = await authorizeEntityRecipient(tx, { userId: candidate.id, role: candidate.role, scope: { kind: "ENTITY", type: "JOB_OFFICE", id: jobId } });
    if (authorization.ok) allowed.push({ userId: candidate.id, role: candidate.role });
  }
  return allowed;
}

/** The cleaners still on the job (the asker first), so whoever is cleaning hears the answer. */
async function cleanerRecipients(tx: Tx, jobId: string, askerId: string): Promise<Array<{ userId: string; role: Role }>> {
  const assignments = await tx.jobAssignment.findMany({
    where: { jobId, removedAt: null, user: { isActive: true, role: Role.CLEANER } },
    select: { userId: true },
    orderBy: { userId: "asc" },
  });
  const ids = Array.from(new Set(assignments.map((row) => row.userId)));
  ids.sort((a, b) => (a === askerId ? -1 : b === askerId ? 1 : 0));
  return ids.map((userId) => ({ userId, role: Role.CLEANER }));
}

function sentence(wording: Awaited<ReturnType<typeof loadNotificationWording>>, partId: string, note: string | null | undefined): string {
  const text = note?.trim();
  return text ? wording.line(partId, "INBOX", { note: text }, true) : "";
}

export async function askUnusedCheck(actor: UnusedCheckActor, jobId: string, raw: unknown): Promise<UnusedCheckWriteResult<AskOutcome>> {
  const input = askUnusedCheckInput.parse(raw);
  const photoKeys = Array.from(new Set(input.photoKeys ?? []));
  if (uploadKeysNotOwnedBy(photoKeys, [actor.id]).length > 0) {
    throw new UnusedCheckError(400, FOREIGN_UPLOAD_MESSAGE, "FOREIGN_UPLOAD_REFERENCE");
  }
  const wording = await loadNotificationWording(UNUSED_CHECK_TYPE_KEY);
  return db.$transaction(async (tx) => {
    const replay = await tx.jobUnusedCheck.findUnique({ where: { requestedById_requestKey: { requestedById: actor.id, requestKey: input.requestKey } } });
    if (replay) {
      if (replay.jobId !== jobId) throw new UnusedCheckError(409, "This request was already used for another job. Reload and try again.", "REQUEST_KEY_REUSED");
      return { outcome: "REPLAYED" as const, check: replay, intentIds: [] };
    }

    const assignment = await tx.jobAssignment.findFirst({
      where: { jobId, userId: actor.id, removedAt: null },
      select: { responseStatus: true },
    });
    if (!assignment) throw new UnusedCheckError(403, "You are not assigned to this job.", "NOT_ASSIGNED");
    const job = await tx.job.findUnique({ where: { id: jobId }, select: { status: true, jobType: true } });
    if (!job) throw new UnusedCheckError(404, "Job not found.", "NOT_FOUND");
    const eligibility = unusedCheckEligibility({ jobType: job.jobType, jobStatus: job.status, responseStatus: assignment.responseStatus });
    if (!eligibility.ok) throw new UnusedCheckError(409, eligibility.reason, "NOT_ELIGIBLE");

    await lockJob(tx, jobId);
    const open = await tx.jobUnusedCheck.findUnique({ where: { openForJobId: jobId } });
    if (open) return { outcome: "ALREADY_OPEN" as const, check: open, intentIds: [] };

    const check = await tx.jobUnusedCheck.create({
      data: {
        jobId,
        openForJobId: jobId,
        requestedById: actor.id,
        requestKey: input.requestKey,
        note: input.note?.trim() || null,
        photoKeys,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        jobId,
        action: "JOB_UNUSED_CHECK_ASKED",
        entity: "JobUnusedCheck",
        entityId: check.id,
        after: { note: check.note, photoCount: photoKeys.length } as Prisma.InputJsonValue,
      },
    });

    const context = await readJobContext(tx, jobId);
    const cleaner = await tx.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } });
    const text = wording.render("asked", "INBOX", {
      cleanerName: cleaner?.name || cleaner?.email || "A cleaner",
      propertyName: context?.propertyName ?? "the property",
      jobNumber: context?.jobNumber ?? jobId,
      cleanerNoteSentence: sentence(wording, "cleaner-note", check.note),
    });
    const intentIds: string[] = [];
    for (const recipient of await officeRecipients(tx, jobId)) {
      const intent = await enqueueNotificationIntent(tx, {
        version: 1,
        eventId: `${check.id}:asked`,
        eventKey: UNUSED_CHECK_ASKED_EVENT,
        entity: { type: "job_unused_check", id: check.id },
        actorId: actor.id,
        recipient: { userId: recipient.userId, role: recipient.role, scope: { kind: "ENTITY", type: "JOB_OFFICE", id: jobId } },
        severity: "ACTION",
        category: "approvals",
        transport: "INBOX",
        mobilePushCategory: "approvals",
        url: `/v2/admin/approvals?queue=unusedChecks&open=${encodeURIComponent(check.id)}`,
        subject: text.title,
        body: text.body,
        jobId,
      });
      intentIds.push(intent.id);
    }
    return { outcome: "CREATED" as const, check, intentIds };
  });
}

export async function answerUnusedCheck(actor: UnusedCheckActor, checkId: string, raw: unknown): Promise<UnusedCheckWriteResult<AnswerOutcome>> {
  const input = answerUnusedCheckInput.parse(raw);
  const note = input.note?.trim() || null;
  const wording = await loadNotificationWording(UNUSED_CHECK_TYPE_KEY);
  return db.$transaction(async (tx) => {
    const found = await tx.jobUnusedCheck.findUnique({ where: { id: checkId }, select: { jobId: true } });
    if (!found) throw new UnusedCheckError(404, "This question was not found. Reload Approvals.", "NOT_FOUND");
    await lockJob(tx, found.jobId);
    const current = await tx.jobUnusedCheck.findUniqueOrThrow({ where: { id: checkId } });
    if (current.decidedAt) {
      // A repeat of the same answer (double tap, retry) is the same answer.
      if (current.decision === input.decision && (current.decisionNote ?? null) === note && current.decidedById === actor.id) {
        return { outcome: "REPLAYED" as const, check: current, intentIds: [] };
      }
      throw new UnusedCheckError(409, "This question was already answered. Reload to see the answer.", "ALREADY_ANSWERED");
    }

    const check = await tx.jobUnusedCheck.update({
      where: { id: checkId },
      data: {
        decision: input.decision,
        decisionNote: note,
        decidedById: actor.id,
        decidedByRole: actor.role,
        decidedAt: new Date(),
        openForJobId: null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        jobId: check.jobId,
        action: "JOB_UNUSED_CHECK_ANSWERED",
        entity: "JobUnusedCheck",
        entityId: check.id,
        before: { decision: null } as Prisma.InputJsonValue,
        after: { decision: check.decision, decisionNote: check.decisionNote, actorRole: actor.role } as Prisma.InputJsonValue,
      },
    });

    const context = await readJobContext(tx, check.jobId);
    const decision = input.decision as UnusedCheckDecision;
    const text = wording.render("answered", "INBOX", {
      propertyName: context?.propertyName ?? "the property",
      jobNumber: context?.jobNumber ?? check.jobId,
      officeAnswer: UNUSED_CHECK_DECISION_LABELS[decision],
      answerGuidance: UNUSED_CHECK_DECISION_GUIDANCE[decision],
      officeNoteSentence: sentence(wording, "office-note", note),
    });
    const intentIds: string[] = [];
    for (const recipient of await cleanerRecipients(tx, check.jobId, check.requestedById)) {
      const intent = await enqueueNotificationIntent(tx, {
        version: 1,
        eventId: `${check.id}:answered`,
        eventKey: UNUSED_CHECK_ANSWERED_EVENT,
        entity: { type: "job_unused_check", id: check.id },
        actorId: actor.id,
        recipient: { userId: recipient.userId, role: recipient.role, scope: { kind: "ENTITY", type: "JOB_ASSIGNED_CLEANER", id: check.jobId } },
        severity: "ACTION",
        category: "jobs",
        transport: "INBOX",
        mobilePushCategory: "jobs",
        url: `/v2/cleaner/jobs/${encodeURIComponent(check.jobId)}`,
        subject: text.title,
        body: text.body,
        jobId: check.jobId,
      });
      intentIds.push(intent.id);
    }
    return { outcome: "ANSWERED" as const, check, intentIds };
  });
}

/** Every question on one job, newest first, as an assigned cleaner may see it (no office identities). */
export async function listUnusedChecksForCleaner(jobId: string, viewerId: string): Promise<UnusedCheckView[]> {
  const rows = await db.jobUnusedCheck.findMany({ where: { jobId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 });
  return rows.map((row) => ({
    id: row.id,
    jobId: row.jobId,
    status: row.decidedAt ? "ANSWERED" : "WAITING",
    note: row.note,
    photoCount: row.photoKeys.length,
    askedAt: row.createdAt.toISOString(),
    askedByMe: row.requestedById === viewerId,
    decision: (row.decision as UnusedCheckDecision | null) ?? null,
    decisionNote: row.decisionNote,
    answeredAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  }));
}
