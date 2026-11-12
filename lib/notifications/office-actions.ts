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
import { LAUNDRY_TEAM_REQUEST_KINDS, NUDGE_COOL_DOWN_MINUTES, NUDGE_LABELS, TEAM_REQUEST_LABELS, laundryTeamRequestKinds, type LaundryTeamRequestKind } from "@/lib/laundry/nudge-rules";
import { detectExceptions, latestReadiness } from "@/lib/laundry/pipeline";
import { loadSupplierTeams, teamForRun } from "@/lib/laundry/partners";
import { sydneyTodayKey } from "@/lib/time/sydney-range";
import type { OfficeActorRole } from "@/lib/notifications/office-send-rules";
import { defaultNotificationWording, loadNotificationWording, type WordingRenderer } from "./wording/render";

/**
 * Office-initiated messages the other redesign steps had to leave out because
 * no path existed. Each has an explicit recipient scope (re-checked at
 * dispatch), transports chosen by the sender, an audit row and truthful
 * per-recipient states. The routes decide who may call them:
 * - staff message and laundry nudge: ADMIN and OPS_MANAGER (both can already
 *   message staff and remind cleaners);
 * - client delay notice and the clock-paused notice (sent by the Live ops
 *   clock pause, lib/jobs/admin-clock-pause.ts): ADMIN, or OPS_MANAGER with the
 *   Jobs pack at manage (owner decision 2026-11-12, `office-send-rules.ts`).
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
async function refuseWithinNudgeCoolDown(taskId: string, kind: string, idempotencyKey: string | undefined, action = "LAUNDRY_CLEANER_NUDGE_SENT") {
  const since = new Date(Date.now() - LAUNDRY_NUDGE_COOL_DOWN_MINUTES * 60_000);
  const recent = await db.auditLog.findFirst({
    where: { action, entity: "LaundryTask", entityId: taskId, createdAt: { gte: since }, after: { path: ["kind"], equals: kind } },
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
  const wording = await loadNotificationWording(typeKey);
  const values = {
    laundryAsk: NUDGE_LABELS[request.kind].text,
    propertyName: place,
    jobNumber: task.job.jobNumber ?? task.jobId,
    noteSuffix: wording.line("note-line", "INBOX", { note: request.note }, Boolean(request.note)),
  };
  const inbox = wording.render(request.kind === "REQUEST_PHOTO" ? "photo" : "ask", "INBOX", values);
  const body = inbox.body;
  const email = wording.render("cleaner", "EMAIL", { ...values, messageText: body });
  const outcomes = await sendOfficeNotification({
    typeKey, eventKey: typeKey, eventId: `laundry-nudge:${task.id}:${request.kind}:${requestId}`,
    entity: { type: "LaundryTask", id: task.id }, actorId,
    scopeType: "LAUNDRY_TASK_CLEANER", scopeId: () => task.id,
    category: "laundry", severity: "ACTION", jobId: task.jobId,
    subject: inbox.title,
    body, url: "/cleaner/jobs",
    email: () => ({ subject: email.subject, html: email.html }),
    emailKind: "admin_alert",
    transports: request.transports, recipients,
    respectsPreferences: typeRespectsPreferences(controls, typeKey),
    disabledTransports: controls.disabledTransports[typeKey] ?? [],
  });
  const result = { outcomes, refused: [] };
  await audit(actorId, "LAUNDRY_CLEANER_NUDGE_SENT", "LaundryTask", task.id, task.jobId, result, { kind: request.kind, transports: request.transports, note: request.note ?? null, idempotencyKey: request.idempotencyKey ?? null });
  return result;
}

export const laundryTeamRequestSchema = z.object({
  laundryTaskId: z.string().trim().min(1).max(200),
  kind: z.enum(LAUNDRY_TEAM_REQUEST_KINDS as [LaundryTeamRequestKind, ...LaundryTeamRequestKind[]]),
  note: z.string().trim().max(1000).optional(),
  transports: transportsSchema,
  idempotencyKey: keySchema,
}).strict();

export const LAUNDRY_TEAM_REQUEST_ACTION = "LAUNDRY_TEAM_REQUEST_SENT";

/** The wording part of each request kind (its title is the part's inbox title). */
const TEAM_REQUEST_PARTS: Record<LaundryTeamRequestKind, string> = {
  TEAM_CONFIRM_PICKUP: "confirm-pickup",
  TEAM_CONFIRM_DROP: "confirm-drop",
  TEAM_RETURN_ETA: "return-eta",
  TEAM_PHOTO: "photo",
};

/**
 * (b2) Ask the laundry partner's team about a run (owner decision 2026-11-12:
 * pickup and drop-off are the partner's work). Recipients: the active LAUNDRY
 * users linked to the run's supplier who may see the property (scope
 * LAUNDRY_TASK_SUPPLIER_TEAM, re-checked when queued and at dispatch). The
 * request must still apply to the run as it is now (the Pipeline's rules);
 * a supplier with no linked portal users is refused with the reason, so the
 * office uses Chase supplier. Same cool-down per run and kind as the nudges.
 */
export async function sendLaundryTeamRequest(actorId: string, input: unknown, actorRole: OfficeActorRole | null = null): Promise<OfficeActionResult> {
  const request = laundryTeamRequestSchema.parse(input);
  const task = await db.laundryTask.findUnique({
    where: { id: request.laundryTaskId },
    select: {
      id: true, jobId: true, status: true, pickupDate: true, dropoffDate: true, pickedUpAt: true, flagReason: true, supplierId: true,
      supplier: { select: { id: true, name: true, avgTurnaround: true } },
      property: { select: { name: true, suburb: true, accessInfo: true, laundryEnabled: true } },
      job: { select: { status: true } },
      confirmations: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { laundryReady: true, photoUrl: true, notes: true, createdAt: true } },
    },
  });
  if (!task) throw new OfficeActionError(404, "Laundry run not found.");
  if (!task.supplier) throw new OfficeActionError(409, "No laundry partner is recorded for this run.");
  const settings = await getAppSettings().catch(() => null);
  const now = new Date();
  const exceptions = detectExceptions(task, {
    todayKey: sydneyTodayKey(now),
    now,
    settings: { maxOutdoorDays: settings?.laundryOperations?.maxOutdoorDays ?? 3, requireDropoffPhoto: settings?.laundryPortalVisibility?.requireDropoffPhoto === true },
  });
  const applicable = laundryTeamRequestKinds({
    status: task.status, pickupDate: task.pickupDate, dropoffDate: task.dropoffDate, exceptions,
    readiness: latestReadiness(task.confirmations), jobStatus: task.job?.status ?? null, hasJob: Boolean(task.jobId), hasSupplier: true,
  }, sydneyTodayKey(now));
  if (!applicable.includes(request.kind)) throw new OfficeActionError(409, "This request no longer applies to the run. Reload the Pipeline.");
  const teams = await loadSupplierTeams([task.supplier.id]);
  const team = teamForRun(teams, task.supplier.id, task.property);
  if (!team.length) throw new OfficeActionError(409, `${task.supplier.name} has no laundry portal users who can see this property. Use Chase supplier instead.`);
  await refuseWithinNudgeCoolDown(task.id, request.kind, request.idempotencyKey, LAUNDRY_TEAM_REQUEST_ACTION);

  const typeKey = "laundry.team_request";
  const controls = await getNotificationTypeControls();
  const requestId = request.idempotencyKey ?? randomUUID();
  const place = task.property?.suburb ? `${task.property.name} (${task.property.suburb})` : task.property?.name ?? "the property";
  const label = TEAM_REQUEST_LABELS[request.kind];
  const wording = await loadNotificationWording(typeKey);
  const values = { laundryAsk: label.text, place, noteSuffix: wording.line("note-line", "INBOX", { note: request.note }, Boolean(request.note)) };
  const inbox = wording.render(TEAM_REQUEST_PARTS[request.kind], "INBOX", values);
  const body = inbox.body;
  const email = wording.render("team", "EMAIL", { place, messageText: body });
  const recipients: OfficeRecipient[] = team.map((member) => ({ id: member.id, role: member.role, name: member.name, email: member.email }));
  const outcomes = await sendOfficeNotification({
    typeKey, eventKey: typeKey, eventId: `laundry-team:${task.id}:${request.kind}:${requestId}`,
    entity: { type: "LaundryTask", id: task.id }, actorId,
    scopeType: "LAUNDRY_TASK_SUPPLIER_TEAM", scopeId: () => task.id,
    category: "laundry", severity: "ACTION", jobId: task.jobId,
    subject: inbox.title,
    body, url: `/v2/laundry?request=${encodeURIComponent(task.id)}#office-requests`,
    email: () => ({ subject: email.subject, html: email.html }),
    emailKind: "admin_alert",
    transports: request.transports, recipients,
    respectsPreferences: typeRespectsPreferences(controls, typeKey),
    disabledTransports: controls.disabledTransports[typeKey] ?? [],
  });
  const result = { outcomes, refused: [] };
  await audit(actorId, LAUNDRY_TEAM_REQUEST_ACTION, "LaundryTask", task.id, task.jobId, result, {
    kind: request.kind, transports: request.transports, note: request.note ?? null, idempotencyKey: request.idempotencyKey ?? null,
    supplierId: task.supplier.id, actorRole, recipientIds: recipients.map((recipient) => recipient.id),
  });
  return result;
}

export const clientDelaySchema = z.object({
  jobId: z.string().trim().min(1).max(200),
  etaMinutes: z.number().int().min(1).max(600).optional(),
  note: z.string().trim().max(1000).optional(),
  transports: transportsSchema,
  idempotencyKey: keySchema,
}).strict();

export const CLIENT_DELAY_TYPE_KEY = "client.delay_notice";

/** The client delay wording, shared by the send and the confirm preview (pass the loaded wording). */
export function clientDelayBody(propertyName: string | null, etaMinutes?: number | null, note?: string | null, wording: WordingRenderer = defaultNotificationWording(CLIENT_DELAY_TYPE_KEY)): string {
  return clientDelayInbox(wording, propertyName, etaMinutes, note).body;
}

function clientDelayInbox(wording: WordingRenderer, propertyName: string | null, etaMinutes?: number | null, note?: string | null) {
  return wording.render("client", "INBOX", {
    propertyName: propertyName ?? "your property",
    etaSentence: wording.line("eta-line", "INBOX", { etaMinutes }, Boolean(etaMinutes)),
    noteSuffix: wording.line("note-line", "INBOX", { note }, Boolean(note)),
  });
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

/**
 * (c) Tell the client their clean is running late. ADMIN, or OPS_MANAGER with
 * the Jobs pack at manage (route, `office-send-rules.ts`); `actorRole` is kept
 * on the audit row.
 */
export async function sendClientDelayNotice(actorId: string, input: unknown, actorRole: OfficeActorRole | null = null): Promise<OfficeActionResult> {
  const request = clientDelaySchema.parse(input);
  const { job, recipients } = await resolveClientDelayTarget(request.jobId);
  const typeKey = CLIENT_DELAY_TYPE_KEY;
  const controls = await getNotificationTypeControls();
  const requestId = request.idempotencyKey ?? randomUUID();
  const wording = await loadNotificationWording(typeKey);
  const inbox = clientDelayInbox(wording, job.property?.name ?? null, request.etaMinutes, request.note);
  const body = inbox.body;
  const outcomes = await sendOfficeNotification({
    typeKey, eventKey: typeKey, eventId: `client-delay:${job.id}:${requestId}`,
    entity: { type: "Job", id: job.id }, actorId,
    scopeType: "JOB_CLIENT_CONTACT", scopeId: () => job.id,
    category: "jobs", severity: "INFO", jobId: job.id,
    subject: inbox.title, body, url: "/client",
    email: (recipient) => {
      const email = wording.render("client", "EMAIL", { recipientName: recipient.name ?? "there", propertyName: job.property?.name ?? "your property", messageText: body });
      return { subject: email.subject, html: email.html };
    },
    emailKind: "client_job_update",
    transports: request.transports, recipients,
    respectsPreferences: typeRespectsPreferences(controls, typeKey),
    disabledTransports: controls.disabledTransports[typeKey] ?? [],
  });
  const result = { outcomes, refused: [] };
  await audit(actorId, "CLIENT_DELAY_NOTICE_SENT", "Job", job.id, job.id, result, { actorRole, etaMinutes: request.etaMinutes ?? null, transports: request.transports, idempotencyKey: request.idempotencyKey ?? null });
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
  const wording = await loadNotificationWording(typeKey);
  const values = { jobLabel: input.jobLabel, time: at, reason: input.reason };
  const inbox = wording.render("cleaner", "INBOX", values);
  const body = inbox.body;
  const email = wording.render("cleaner", "EMAIL", { ...values, messageText: body });
  return sendOfficeNotification({
    typeKey, eventKey: typeKey, eventId: `clock-pause:${input.timeLogId}`,
    entity: { type: "TimeLog", id: input.timeLogId }, actorId: input.actorId,
    scopeType: "JOB_ASSIGNED_CLEANER", scopeId: () => input.jobId,
    category: "jobs", severity: "ACTION", jobId: input.jobId,
    subject: inbox.title, body, url: `/cleaner/jobs/${input.jobId}`,
    email: () => ({ subject: email.subject, html: email.html }),
    emailKind: "workforce_update",
    transports: input.transports, recipients: [input.cleaner],
    respectsPreferences: typeRespectsPreferences(controls, typeKey),
    disabledTransports: controls.disabledTransports[typeKey] ?? [],
  });
}
