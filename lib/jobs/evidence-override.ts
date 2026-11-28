import "server-only";
/**
 * "Camera not working — ask the office" (cleaner job flow v2, item 2), server side.
 *
 * askEvidenceOverride     the assigned cleaner asks to submit without
 *                         specific missing photos (one open request per job;
 *                         a retry with the same request key returns the same row).
 * decideEvidenceOverride  an ADMIN or OPS_MANAGER allows some or all of the
 *                         questions, or declines; a reason is required; once.
 * allowedEvidenceFields   the questions the submit route waives on a job.
 *
 * Both writes add an audit row on the job (its History) and queue inbox
 * notices through the notification intent pipeline with explicit transports
 * (inbox + the phone push of its category). Never email or SMS. Queued is
 * not delivered: callers report the inbox state the pipeline returns.
 */
import { Prisma, Role, type JobEvidenceOverride } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueueNotificationIntent } from "@/lib/notifications/intent-store";
import { authorizeEntityRecipient } from "@/lib/notifications/recipient-scopes";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import {
  EVIDENCE_OVERRIDE_FIELDS_MAX,
  EVIDENCE_OVERRIDE_NOTE_MAX,
  EVIDENCE_OVERRIDE_REASON_MIN,
  allowedFieldsOf,
  pairFields,
  type EvidenceOverrideCleanerView,
  type EvidenceOverrideOfficeView,
  type EvidenceOverrideStatus,
} from "./evidence-override-rules";

type Tx = Prisma.TransactionClient;

export const EVIDENCE_OVERRIDE_TYPE_KEY = "job.evidence_override";
export const EVIDENCE_OVERRIDE_ASKED_EVENT = "job_evidence_override.asked";
export const EVIDENCE_OVERRIDE_DECIDED_EVENT = "job_evidence_override.decided";

/** Job statuses in which a cleaner can still ask (the job is being worked, not finished). */
const ASKABLE_STATUSES = new Set(["ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"]);

export class EvidenceOverrideError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

const fieldInput = z.object({
  fieldId: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(300),
});

export const askEvidenceOverrideInput = z.object({
  requestKey: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
  note: z.string().trim().min(EVIDENCE_OVERRIDE_REASON_MIN).max(EVIDENCE_OVERRIDE_NOTE_MAX),
  fields: z.array(fieldInput).min(1).max(EVIDENCE_OVERRIDE_FIELDS_MAX),
});
export type AskEvidenceOverrideInput = z.infer<typeof askEvidenceOverrideInput>;

export const decideEvidenceOverrideInput = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("ALLOW"),
    allowedFieldIds: z.array(z.string().trim().min(1).max(200)).min(1).max(EVIDENCE_OVERRIDE_FIELDS_MAX),
    reason: z.string().trim().min(EVIDENCE_OVERRIDE_REASON_MIN).max(EVIDENCE_OVERRIDE_NOTE_MAX),
  }),
  z.object({
    decision: z.literal("DECLINE"),
    reason: z.string().trim().min(EVIDENCE_OVERRIDE_REASON_MIN).max(EVIDENCE_OVERRIDE_NOTE_MAX),
  }),
]);
export type DecideEvidenceOverrideInput = z.infer<typeof decideEvidenceOverrideInput>;

export type EvidenceOverrideActor = { id: string; role: Role };
export type AskOutcome = "CREATED" | "REPLAYED" | "ALREADY_OPEN";
export type DecideOutcome = "DECIDED" | "REPLAYED";

export type EvidenceOverrideWriteResult<Outcome> = {
  outcome: Outcome;
  request: JobEvidenceOverride;
  /** Intents queued by this call (none on a replay). */
  intentIds: string[];
};

async function lockJob(tx: Tx, jobId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-evidence-override:${jobId}`}))`;
}

type JobContext = { jobNumber: string; propertyName: string };

async function readJobContext(tx: Tx, jobId: string): Promise<JobContext> {
  const job = await tx.job.findUnique({ where: { id: jobId }, select: { jobNumber: true, property: { select: { name: true } } } });
  return { jobNumber: job?.jobNumber ?? jobId, propertyName: job?.property?.name ?? "the property" };
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

export async function askEvidenceOverride(actor: EvidenceOverrideActor, jobId: string, raw: unknown): Promise<EvidenceOverrideWriteResult<AskOutcome>> {
  const input = askEvidenceOverrideInput.parse(raw);
  const fields = Array.from(new Map(input.fields.map((field) => [field.fieldId, field])).values());
  const wording = await loadNotificationWording(EVIDENCE_OVERRIDE_TYPE_KEY);
  return db.$transaction(async (tx) => {
    // Lock first, so a double tap waits and then finds its own row (a replay).
    await lockJob(tx, jobId);
    const replay = await tx.jobEvidenceOverride.findUnique({ where: { requestedById_requestKey: { requestedById: actor.id, requestKey: input.requestKey } } });
    if (replay) {
      if (replay.jobId !== jobId) throw new EvidenceOverrideError(409, "This request was already used for another job. Reload and try again.", "REQUEST_KEY_REUSED");
      return { outcome: "REPLAYED" as const, request: replay, intentIds: [] };
    }
    const assignment = await tx.jobAssignment.findFirst({ where: { jobId, userId: actor.id, removedAt: null }, select: { id: true } });
    if (!assignment) throw new EvidenceOverrideError(403, "You are not assigned to this job.", "NOT_ASSIGNED");
    const job = await tx.job.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!job) throw new EvidenceOverrideError(404, "Job not found.", "NOT_FOUND");
    if (!ASKABLE_STATUSES.has(job.status)) throw new EvidenceOverrideError(409, "This job is not being worked, so there is nothing to ask.", "NOT_ELIGIBLE");

    const open = await tx.jobEvidenceOverride.findUnique({ where: { openForJobId: jobId } });
    if (open) return { outcome: "ALREADY_OPEN" as const, request: open, intentIds: [] };

    const request = await tx.jobEvidenceOverride.create({
      data: {
        jobId,
        openForJobId: jobId,
        requestedById: actor.id,
        requestKey: input.requestKey,
        note: input.note,
        fieldIds: fields.map((field) => field.fieldId),
        fieldLabels: fields.map((field) => field.label),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        jobId,
        action: "JOB_EVIDENCE_OVERRIDE_ASKED",
        entity: "JobEvidenceOverride",
        entityId: request.id,
        after: { note: request.note, fieldIds: request.fieldIds } as Prisma.InputJsonValue,
      },
    });

    const context = await readJobContext(tx, jobId);
    const cleaner = await tx.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } });
    const text = wording.render("asked", "INBOX", {
      cleanerName: cleaner?.name || cleaner?.email || "A cleaner",
      propertyName: context.propertyName,
      jobNumber: context.jobNumber,
      photoCount: String(fields.length),
      note: request.note,
    });
    const intentIds: string[] = [];
    for (const recipient of await officeRecipients(tx, jobId)) {
      const intent = await enqueueNotificationIntent(tx, {
        version: 1,
        eventId: `${request.id}:asked`,
        eventKey: EVIDENCE_OVERRIDE_ASKED_EVENT,
        entity: { type: "job_evidence_override", id: request.id },
        actorId: actor.id,
        recipient: { userId: recipient.userId, role: recipient.role, scope: { kind: "ENTITY", type: "JOB_OFFICE", id: jobId } },
        severity: "ACTION",
        category: "approvals",
        transport: "INBOX",
        mobilePushCategory: "approvals",
        url: `/v2/admin/jobs/${encodeURIComponent(jobId)}#missing-photos`,
        subject: text.title,
        body: text.body,
        jobId,
      });
      intentIds.push(intent.id);
    }
    return { outcome: "CREATED" as const, request, intentIds };
  });
}

export async function decideEvidenceOverride(actor: EvidenceOverrideActor, requestId: string, raw: unknown): Promise<EvidenceOverrideWriteResult<DecideOutcome>> {
  const input = decideEvidenceOverrideInput.parse(raw);
  const wording = await loadNotificationWording(EVIDENCE_OVERRIDE_TYPE_KEY);
  return db.$transaction(async (tx) => {
    const found = await tx.jobEvidenceOverride.findUnique({ where: { id: requestId }, select: { jobId: true } });
    if (!found) throw new EvidenceOverrideError(404, "This request was not found. Reload the job.", "NOT_FOUND");
    await lockJob(tx, found.jobId);
    const current = await tx.jobEvidenceOverride.findUniqueOrThrow({ where: { id: requestId } });
    const status: EvidenceOverrideStatus = input.decision === "ALLOW" ? "ALLOWED" : "DECLINED";
    const allowedFieldIds = input.decision === "ALLOW" ? Array.from(new Set(input.allowedFieldIds)).sort() : [];
    if (current.decidedAt) {
      const same =
        current.status === status &&
        current.decisionReason === input.reason &&
        current.decidedById === actor.id &&
        [...current.allowedFieldIds].sort().join("\n") === allowedFieldIds.join("\n");
      if (same) return { outcome: "REPLAYED" as const, request: current, intentIds: [] };
      throw new EvidenceOverrideError(409, "This request was already decided. Reload to see the decision.", "ALREADY_DECIDED");
    }
    const asked = new Set(current.fieldIds);
    if (allowedFieldIds.some((fieldId) => !asked.has(fieldId))) {
      throw new EvidenceOverrideError(400, "Only the photos the cleaner asked about can be allowed.", "FIELD_NOT_REQUESTED");
    }

    const request = await tx.jobEvidenceOverride.update({
      where: { id: requestId },
      data: {
        status,
        allowedFieldIds,
        decisionReason: input.reason,
        decidedById: actor.id,
        decidedByRole: actor.role,
        decidedAt: new Date(),
        openForJobId: null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        jobId: request.jobId,
        action: status === "ALLOWED" ? "JOB_EVIDENCE_OVERRIDE_ALLOWED" : "JOB_EVIDENCE_OVERRIDE_DECLINED",
        entity: "JobEvidenceOverride",
        entityId: request.id,
        before: { status: current.status } as Prisma.InputJsonValue,
        after: { status, allowedFieldIds, reason: input.reason, actorRole: actor.role } as Prisma.InputJsonValue,
      },
    });

    const context = await readJobContext(tx, request.jobId);
    const labels = pairFields(request.fieldIds, request.fieldLabels).filter((field) => allowedFieldIds.includes(field.fieldId)).map((field) => field.label);
    const text = wording.render("decided", "INBOX", {
      propertyName: context.propertyName,
      jobNumber: context.jobNumber,
      decision: status === "ALLOWED" ? "allowed without photos" : "declined",
      guidance: status === "ALLOWED" ? `You can submit without: ${labels.join(", ")}.` : "Take the photos before you submit, or call the office.",
      reason: input.reason,
    });
    const intentIds: string[] = [];
    const stillAssigned = await tx.jobAssignment.findFirst({ where: { jobId: request.jobId, userId: request.requestedById, removedAt: null }, select: { id: true } });
    if (stillAssigned) {
      const intent = await enqueueNotificationIntent(tx, {
        version: 1,
        eventId: `${request.id}:decided`,
        eventKey: EVIDENCE_OVERRIDE_DECIDED_EVENT,
        entity: { type: "job_evidence_override", id: request.id },
        actorId: actor.id,
        recipient: { userId: request.requestedById, role: Role.CLEANER, scope: { kind: "ENTITY", type: "JOB_ASSIGNED_CLEANER", id: request.jobId } },
        severity: "ACTION",
        category: "jobs",
        transport: "INBOX",
        mobilePushCategory: "jobs",
        url: `/v2/cleaner/jobs/${encodeURIComponent(request.jobId)}`,
        subject: text.title,
        body: text.body,
        jobId: request.jobId,
      });
      intentIds.push(intent.id);
    }
    return { outcome: "DECIDED" as const, request, intentIds };
  });
}

type OverrideReader = { jobEvidenceOverride: { findMany: (args: { where: { jobId: string; status: "ALLOWED" }; select: { status: true; allowedFieldIds: true } }) => Promise<Array<{ status: string; allowedFieldIds: string[] }>> } };

/** The questions the office allowed to be submitted without photos on this job. */
export async function allowedEvidenceFields(database: OverrideReader, jobId: string): Promise<string[]> {
  const rows = await database.jobEvidenceOverride.findMany({ where: { jobId, status: "ALLOWED" }, select: { status: true, allowedFieldIds: true } });
  return allowedFieldsOf(rows);
}

function cleanerView(row: JobEvidenceOverride): EvidenceOverrideCleanerView {
  return {
    id: row.id,
    status: row.status as EvidenceOverrideStatus,
    note: row.note,
    fields: pairFields(row.fieldIds, row.fieldLabels),
    allowedFieldIds: row.allowedFieldIds,
    decisionReason: row.decisionReason,
    askedAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

/** Every request on one job, newest first, as an assigned cleaner may see it (no office identities). */
export async function listEvidenceOverridesForCleaner(jobId: string): Promise<EvidenceOverrideCleanerView[]> {
  const rows = await db.jobEvidenceOverride.findMany({ where: { jobId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 });
  return rows.map(cleanerView);
}

/** Every request on one job, newest first, with who asked and who decided (office). */
export async function listEvidenceOverridesForOffice(jobId: string): Promise<EvidenceOverrideOfficeView[]> {
  const rows = await db.jobEvidenceOverride.findMany({ where: { jobId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50 });
  const ids = Array.from(new Set(rows.flatMap((row) => [row.requestedById, row.decidedById]).filter((id): id is string => Boolean(id))));
  const users = ids.length > 0 ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const names = new Map(users.map((user) => [user.id, user.name || user.email || user.id]));
  return rows.map((row) => ({
    ...cleanerView(row),
    requestedByName: names.get(row.requestedById) ?? "Unknown person",
    decidedByName: row.decidedById ? names.get(row.decidedById) ?? "Unknown person" : null,
    decidedByRole: row.decidedByRole,
  }));
}
