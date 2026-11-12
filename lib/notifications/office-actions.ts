import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { escapeHtml } from "@/lib/utils/escape-html";
import { sendOfficeNotification, type OfficeRecipient, type RecipientOutcome } from "./office-sends";
import { STAFF_MESSAGE_ROLES } from "./recipient-scopes";
import { getNotificationTypeControls, typeRespectsPreferences } from "./type-controls";
import { formatInTimeZone } from "date-fns-tz";
import { getAppSettings } from "@/lib/settings";
import { NUDGE_COOL_DOWN_MINUTES, NUDGE_LABELS } from "@/lib/laundry/nudge-rules";

/**
 * Office-initiated messages the other redesign steps had to leave out because
 * no path existed. Each has an explicit recipient scope (re-checked at
 * dispatch), transports chosen by the sender, an audit row and truthful
 * per-recipient states. The routes decide who may call them:
 * - staff message and laundry nudge: ADMIN and OPS_MANAGER (both can already
 *   message staff and remind cleaners);
 * - client delay notice: ADMIN only, pending the owner's decision;
 * - clock-paused notice: sent by the ADMIN-only Live ops clock pause
 *   (lib/jobs/admin-clock-pause.ts).
 */
const transportsSchema = z.array(z.enum(["PUSH", "EMAIL"])).min(1).max(2);
const keySchema = z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/).optional();
const textSchema = z.string().trim().min(1).max(1000);

export type OfficeActionResult = {
  outcomes: RecipientOutcome[];
  /** Requested recipients that were refused before anything was queued, with the reason. */
  refused: Array<{ id: string; reason: string }>;
};

export class OfficeActionError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const userSelect = { id: true, role: true, name: true, email: true, isActive: true } satisfies Prisma.UserSelect;

async function audit(actorId: string, action: string, entity: string, entityId: string, jobId: string | null, result: OfficeActionResult, extra: Record<string, unknown>) {
  await db.auditLog.create({ data: {
    userId: actorId, jobId, action, entity, entityId,
    after: {
      ...extra,
      refused: result.refused,
      outcomes: result.outcomes.map((outcome) => ({ userId: outcome.userId, transport: outcome.transport, path: outcome.path, state: outcome.state, errorCode: outcome.errorCode ?? null })),
      deliveryConfirmed: false,
    } as Prisma.InputJsonValue,
  } });
}

export const staffMessageSchema = z.object({
  recipientIds: z.array(z.string().trim().min(1).max(200)).min(1).max(200),
  subject: z.string().trim().min(1).max(200),
  body: textSchema,
  transports: transportsSchema,
  idempotencyKey: keySchema,
}).strict();

/** (a) Message to selected staff members. */
export async function sendStaffMessage(actorId: string, input: unknown): Promise<OfficeActionResult> {
  const request = staffMessageSchema.parse(input);
  const ids = Array.from(new Set(request.recipientIds));
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: userSelect });
  const refused: OfficeActionResult["refused"] = [];
  const recipients: OfficeRecipient[] = [];
  for (const id of ids) {
    const user = users.find((row) => row.id === id);
    if (!user) refused.push({ id, reason: "Account not found." });
    else if (!user.isActive) refused.push({ id, reason: "Account is not active." });
    else if (!STAFF_MESSAGE_ROLES.includes(user.role)) refused.push({ id, reason: "Not a staff account." });
    else recipients.push({ id: user.id, role: user.role, name: user.name, email: user.email });
  }
  const typeKey = "office.staff_message";
  const controls = await getNotificationTypeControls();
  const requestId = request.idempotencyKey ?? randomUUID();
  const outcomes = recipients.length ? await sendOfficeNotification({
    typeKey, eventKey: typeKey, eventId: `staff-message:${actorId}:${requestId}`,
    entity: { type: "StaffMessage", id: requestId }, actorId,
    scopeType: "STAFF_MEMBER", scopeId: (recipient) => recipient.id,
    category: "account", severity: "INFO", jobId: null,
    subject: request.subject, body: request.body,
    email: () => ({ subject: request.subject, html: `<p>${escapeHtml(request.body).replace(/\n/g, "<br>")}</p>` }),
    emailKind: "workforce_update",
    transports: request.transports, recipients,
    respectsPreferences: typeRespectsPreferences(controls, typeKey),
    disabledTransports: controls.disabledTransports[typeKey] ?? [],
  }) : [];
  const result = { outcomes, refused };
  await audit(actorId, "OFFICE_STAFF_MESSAGE_SENT", "StaffMessage", requestId, null, result, { recipientIds: recipients.map((recipient) => recipient.id), transports: request.transports, subject: request.subject });
  return result;
}

export const laundryNudgeSchema = z.object({
  laundryTaskId: z.string().trim().min(1).max(200),
  kind: z.enum(["ASK_CLEANER", "REQUEST_PHOTO"]),
  note: z.string().trim().max(1000).optional(),
  transports: transportsSchema,
  idempotencyKey: keySchema,
}).strict();


/** One nudge of a kind per laundry run within this many minutes (shared with the Laundry screen). */
export const LAUNDRY_NUDGE_COOL_DOWN_MINUTES = NUDGE_COOL_DOWN_MINUTES;

async function organisationTimeZone(): Promise<string> {
  return (await getAppSettings().catch(() => null))?.timezone || "Australia/Sydney";
}

/**
 * Cool-down: a second nudge of the same kind for the same run within
 * LAUNDRY_NUDGE_COOL_DOWN_MINUTES is refused with the time of the first. A
 * retry carrying the first request's idempotency key is the same request and
 * passes (the pipeline then answers with the states it already has).
 */
async function refuseWithinNudgeCoolDown(taskId: string, kind: string, idempotencyKey: string | undefined) {
  const since = new Date(Date.now() - LAUNDRY_NUDGE_COOL_DOWN_MINUTES * 60_000);
  const recent = await db.auditLog.findFirst({
    where: { action: "LAUNDRY_CLEANER_NUDGE_SENT", entity: "LaundryTask", entityId: taskId, createdAt: { gte: since }, after: { path: ["kind"], equals: kind } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, after: true },
  });
  if (!recent) return;
  const after = (recent.after ?? {}) as { idempotencyKey?: unknown };
  if (idempotencyKey && after.idempotencyKey === idempotencyKey) return;
  const zone = await organisationTimeZone();
  const at = formatInTimeZone(recent.createdAt, zone, "HH:mm");
  const next = formatInTimeZone(new Date(recent.createdAt.getTime() + LAUNDRY_NUDGE_COOL_DOWN_MINUTES * 60_000), zone, "HH:mm");
  throw new OfficeActionError(409, `Already asked at ${at}. You can ask again after ${next}.`);
}

/** (b) Nudge the cleaner(s) on a laundry run. */
export async function sendLaundryCleanerNudge(actorId: string, input: unknown): Promise<OfficeActionResult> {
  const request = laundryNudgeSchema.parse(input);
  const task = await db.laundryTask.findUnique({
    where: { id: request.laundryTaskId },
    select: { id: true, jobId: true, job: { select: { jobNumber: true, property: { select: { name: true } }, assignments: { where: { removedAt: null, user: { isActive: true } }, select: { user: { select: userSelect } } } } } },
  });
  if (!task) throw new OfficeActionError(404, "Laundry task not found.");
  const recipients = task.job.assignments.map(({ user }) => ({ id: user.id, role: user.role, name: user.name, email: user.email }));
  if (!recipients.length) throw new OfficeActionError(400, "No cleaner is assigned to this job.");
  await refuseWithinNudgeCoolDown(task.id, request.kind, request.idempotencyKey);
  const typeKey = "laundry.cleaner_nudge";
  const controls = await getNotificationTypeControls();
  const requestId = request.idempotencyKey ?? randomUUID();
  const place = task.job.property?.name ?? "the property";
  const body = `${NUDGE_LABELS[request.kind].text} (${place}, ${task.job.jobNumber ?? task.jobId})${request.note ? ` Note: ${request.note}` : ""}`;
  const outcomes = await sendOfficeNotification({
    typeKey, eventKey: typeKey, eventId: `laundry-nudge:${task.id}:${request.kind}:${requestId}`,
    entity: { type: "LaundryTask", id: task.id }, actorId,
    scopeType: "LAUNDRY_TASK_CLEANER", scopeId: () => task.id,
    category: "laundry", severity: "ACTION", jobId: task.jobId,
    subject: request.kind === "REQUEST_PHOTO" ? "Laundry photo requested" : "Laundry update needed",
    body, url: "/cleaner/jobs",
    email: () => ({ subject: `Laundry: ${place}`, html: `<p>${escapeHtml(body)}</p>` }),
    emailKind: "admin_alert",
    transports: request.transports, recipients,
    respectsPreferences: typeRespectsPreferences(controls, typeKey),
    disabledTransports: controls.disabledTransports[typeKey] ?? [],
  });
  const result = { outcomes, refused: [] };
  await audit(actorId, "LAUNDRY_CLEANER_NUDGE_SENT", "LaundryTask", task.id, task.jobId, result, { kind: request.kind, transports: request.transports, note: request.note ?? null, idempotencyKey: request.idempotencyKey ?? null });
  return result;
}

export const clientDelaySchema = z.object({
  jobId: z.string().trim().min(1).max(200),
  etaMinutes: z.number().int().min(1).max(600).optional(),
  note: z.string().trim().max(1000).optional(),
  transports: transportsSchema,
  idempotencyKey: keySchema,
}).strict();

/** The client delay wording, shared by the send and the confirm preview. */
export function clientDelayBody(propertyName: string | null, etaMinutes?: number | null, note?: string | null): string {
  const place = propertyName ?? "your property";
  return `Your clean at ${place} is running late.${etaMinutes ? ` The new estimate is about ${etaMinutes} minutes.` : ""}${note ? ` ${note}` : ""}`;
}

/**
 * The job, its client and the client's active logins, with the same refusals
 * the send applies (no job, no client, client switched notifications off, no
 * active login). Shared by the send and the confirm preview.
 */
export async function resolveClientDelayTarget(jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, jobNumber: true, property: { select: { name: true, client: { select: { id: true, notificationPref: { select: { notificationsEnabled: true } }, users: { where: { role: "CLIENT", isActive: true }, select: userSelect } } } } } },
  });
  if (!job) throw new OfficeActionError(404, "Job not found.");
  const client = job.property?.client;
  if (!client) throw new OfficeActionError(400, "This job has no client to notify.");
  // The client's own "no notifications" choice is honoured, as for every other client job update.
  if (client.notificationPref && !client.notificationPref.notificationsEnabled) throw new OfficeActionError(409, "This client has switched off job notifications.");
  const recipients: OfficeRecipient[] = client.users.map((user) => ({ id: user.id, role: user.role, name: user.name, email: user.email }));
  if (!recipients.length) throw new OfficeActionError(400, "This client has no active login to notify.");
  return { job, recipients };
}

/** (c) Tell the client their clean is running late. ADMIN only (route). */
export async function sendClientDelayNotice(actorId: string, input: unknown): Promise<OfficeActionResult> {
  const request = clientDelaySchema.parse(input);
  const { job, recipients } = await resolveClientDelayTarget(request.jobId);
  const typeKey = "client.delay_notice";
  const controls = await getNotificationTypeControls();
  const requestId = request.idempotencyKey ?? randomUUID();
  const body = clientDelayBody(job.property?.name ?? null, request.etaMinutes, request.note);
  const outcomes = await sendOfficeNotification({
    typeKey, eventKey: typeKey, eventId: `client-delay:${job.id}:${requestId}`,
    entity: { type: "Job", id: job.id }, actorId,
    scopeType: "JOB_CLIENT_CONTACT", scopeId: () => job.id,
    category: "jobs", severity: "INFO", jobId: job.id,
    subject: "Your clean is running late", body, url: "/client",
    email: (recipient) => ({ subject: "Your clean is running late", html: `<p>Hi ${escapeHtml(recipient.name ?? "there")},</p><p>${escapeHtml(body)}</p>` }),
    emailKind: "client_job_update",
    transports: request.transports, recipients,
    respectsPreferences: typeRespectsPreferences(controls, typeKey),
    disabledTransports: controls.disabledTransports[typeKey] ?? [],
  });
  const result = { outcomes, refused: [] };
  await audit(actorId, "CLIENT_DELAY_NOTICE_SENT", "Job", job.id, job.id, result, { etaMinutes: request.etaMinutes ?? null, transports: request.transports, idempotencyKey: request.idempotencyKey ?? null });
  return result;
}

export type ClockPausedNoticeInput = {
  actorId: string;
  jobId: string;
  jobLabel: string;
  cleaner: OfficeRecipient;
  reason: string;
  timeLogId: string;
  stoppedAt: Date;
  transports: Array<"PUSH" | "EMAIL">;
};

/**
 * (d) Tell a cleaner that an administrator paused their clock (Live ops
 * "Pause clock"). One notice per closed time log; the cleaner is addressed
 * through the job's assigned-cleaner scope, so a cleaner since removed from
 * the job is skipped (and the outcome says so). The route audits the pause.
 */
export async function sendClockPausedNotice(input: ClockPausedNoticeInput): Promise<RecipientOutcome[]> {
  const typeKey = "jobs.clock_paused_by_office";
  const controls = await getNotificationTypeControls();
  const at = formatInTimeZone(input.stoppedAt, await organisationTimeZone(), "HH:mm");
  const body = `The office paused your clock on ${input.jobLabel} at ${at}. Reason given: "${input.reason}". Your time up to then is kept. If you are still working, open the job and tap Resume clock.`;
  return sendOfficeNotification({
    typeKey, eventKey: typeKey, eventId: `clock-pause:${input.timeLogId}`,
    entity: { type: "TimeLog", id: input.timeLogId }, actorId: input.actorId,
    scopeType: "JOB_ASSIGNED_CLEANER", scopeId: () => input.jobId,
    category: "jobs", severity: "ACTION", jobId: input.jobId,
    subject: "Your clock was paused by the office", body, url: `/cleaner/jobs/${input.jobId}`,
    email: () => ({ subject: "Your clock was paused by the office", html: `<p>${escapeHtml(body)}</p>` }),
    emailKind: "workforce_update",
    transports: input.transports, recipients: [input.cleaner],
    respectsPreferences: typeRespectsPreferences(controls, typeKey),
    disabledTransports: controls.disabledTransports[typeKey] ?? [],
  });
}
