import "server-only";
import { Prisma, type Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";
import { sendSmsDetailed } from "./sms";
import { sendOfficeNotification, type OfficeRecipient, type RecipientOutcome } from "./office-sends";
import { authorizeEntityRecipient } from "./recipient-scopes";
import { dispatchNotificationOnce } from "./dispatch-once";
import { externalTransportAvailability } from "./external-recipient";
import { getNotificationTypeControls, typeRespectsPreferences } from "./type-controls";
import { loadNotificationWording } from "./wording/render";
import { readSendTransportPreferences, saveTransportChoice, type SendTransportPreferences } from "./send-transport-preference";
import { OfficeActionError } from "./office-actions";
import type { OfficeActor } from "./office-send-permission";
import {
  JOB_MESSAGE_BODY_MAX,
  JOB_MESSAGE_JOB_DAILY_LIMIT,
  JOB_MESSAGE_SENDER_HOURLY_LIMIT,
  JOB_MESSAGE_TRANSPORTS,
  JOB_OFFICE_MESSAGE_AUDIT_ACTION,
  JOB_OFFICE_MESSAGE_TYPE,
  NO_TEAM_REASON,
  jobMessageTransportOptions,
  normalizeJobTransports,
  outcomeReason,
  outcomeState,
  type JobMessageOutcome,
  type JobMessageRecipient,
  type JobMessageTransport,
} from "./job-office-message-rules";
import type { TransportOption } from "@/lib/workforce/document-request-transports";

/**
 * "Message team" on a job (owner decision 2026-11-13). The route
 * (`/api/admin/jobs/[id]/office-message`) checks who may send
 * (`requireOfficeSend("job_team_message")`: ADMIN, or OPS_MANAGER with the
 * Jobs pack at manage; never while impersonating) and passes the real actor.
 *
 * - Recipients: the cleaners assigned to the job NOW (assignment not removed,
 *   account active). Names the office removed are left out; an id that is not
 *   on the job is refused with the reason. The pipeline re-checks the scope
 *   (JOB_ASSIGNED_CLEANER) when it queues and when it dispatches; SMS checks
 *   it again immediately before the provider is called.
 * - Transports: as chosen (Inbox, Push, SMS). Inbox and Push go through the
 *   office pipeline; SMS through the SMS chokepoint, once per request key.
 * - Wording: `job.office_message` in the wording layer; the office's text is
 *   the body ({{messageText}}), the title is editable there.
 * - One request key, one send: a retry with the same key answers with the
 *   recorded outcomes (`replayed: true`) and sends nothing again.
 * - Limits: per sender per hour and per job per day (audit log, survives
 *   restarts), plus an in-process per-sender limit.
 * - Audited on the job (`JOB_OFFICE_MESSAGE_SENT`, shown in the job's
 *   History) with the actor, their role, the text, recipients, transports and
 *   every outcome. Nothing is ever reported as delivered.
 */

const keySchema = z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/);

export const jobOfficeMessageSchema = z.object({
  recipientIds: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  body: z.string().trim().min(1).max(JOB_MESSAGE_BODY_MAX),
  transports: z.array(z.enum(JOB_MESSAGE_TRANSPORTS)).min(1).max(3),
  idempotencyKey: keySchema,
  rememberTransports: z.boolean().optional(),
}).strict();

type TeamMember = OfficeRecipient & { phone: string | null };

type JobTeam = { jobId: string; jobLabel: string; propertyName: string; members: TeamMember[] };

async function loadJobTeam(jobId: string): Promise<JobTeam> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      jobNumber: true,
      property: { select: { name: true } },
      assignments: {
        where: { removedAt: null, user: { isActive: true } },
        orderBy: { isPrimary: "desc" },
        select: { user: { select: { id: true, role: true, name: true, email: true, phone: true } } },
      },
    },
  });
  if (!job) throw new OfficeActionError(404, "Job not found.");
  const propertyName = job.property?.name ?? "the property";
  return {
    jobId: job.id,
    jobLabel: job.jobNumber ? `${job.jobNumber} at ${propertyName}` : propertyName,
    propertyName,
    members: job.assignments.map(({ user }) => ({ id: user.id, role: user.role as Role, name: user.name, email: user.email, phone: user.phone?.trim() || null })),
  };
}

function recipientView(member: TeamMember): JobMessageRecipient {
  return { id: member.id, name: member.name ?? member.email ?? "Cleaner", hasPhone: Boolean(member.phone) };
}

async function transportOptions(members: readonly TeamMember[]): Promise<Record<JobMessageTransport, TransportOption>> {
  const [controls, providers] = await Promise.all([getNotificationTypeControls(), externalTransportAvailability()]);
  return jobMessageTransportOptions({ recipients: members.map(recipientView), switchedOff: controls.disabledTransports[JOB_OFFICE_MESSAGE_TYPE] ?? [], sms: providers.SMS });
}

export type JobOfficeMessagePreview = {
  job: { id: string; label: string };
  recipients: JobMessageRecipient[];
  transports: Record<JobMessageTransport, TransportOption>;
  saved: { transports: string[]; savedAt: string } | null;
  savedReadable: boolean;
  /** The title the cleaner sees (wording layer, editable in Notifications). */
  title: string;
  bodyMax: number;
};

/** What the dialog offers. While impersonating nothing saved is read (and the send is refused). */
export async function previewJobOfficeMessage(jobId: string, sender: { id: string; impersonating: boolean }): Promise<JobOfficeMessagePreview> {
  const team = await loadJobTeam(jobId);
  const [transports, preferences, wording] = await Promise.all([
    transportOptions(team.members),
    sender.impersonating ? Promise.resolve<SendTransportPreferences>({ readable: true, kinds: {} }) : readSendTransportPreferences(sender.id),
    loadNotificationWording(JOB_OFFICE_MESSAGE_TYPE),
  ]);
  const saved = preferences.kinds.job_office_message ?? null;
  return {
    job: { id: team.jobId, label: team.jobLabel },
    recipients: team.members.map(recipientView),
    transports,
    saved: saved ? { transports: [...saved.transports], savedAt: saved.savedAt } : null,
    savedReadable: preferences.readable,
    title: wording.render("cleaner", "INBOX", { jobLabel: team.jobLabel, propertyName: team.propertyName, messageText: "" }).title,
    bodyMax: JOB_MESSAGE_BODY_MAX,
  };
}

export type JobOfficeMessageResult = {
  outcomes: JobMessageOutcome[];
  refused: Array<{ id: string; reason: string }>;
  transportsUsed: JobMessageTransport[];
  /** True when this request key was already sent: nothing was sent again. */
  replayed: boolean;
};

async function replayOf(jobId: string, actorId: string, key: string): Promise<JobOfficeMessageResult | null> {
  const row = await db.auditLog.findFirst({
    where: { action: JOB_OFFICE_MESSAGE_AUDIT_ACTION, entity: "Job", entityId: jobId, userId: actorId, after: { path: ["idempotencyKey"], equals: key } },
    select: { after: true },
  });
  if (!row) return null;
  const after = (row.after ?? {}) as Partial<JobOfficeMessageResult>;
  return { outcomes: after.outcomes ?? [], refused: after.refused ?? [], transportsUsed: after.transportsUsed ?? [], replayed: true };
}

async function enforceLimits(actorId: string, jobId: string, now: Date): Promise<void> {
  if (!rateLimit(`${JOB_OFFICE_MESSAGE_TYPE}:${actorId}`, { limit: JOB_MESSAGE_SENDER_HOURLY_LIMIT, windowMs: 60 * 60_000 }).ok) {
    throw new OfficeActionError(429, `You have sent ${JOB_MESSAGE_SENDER_HOURLY_LIMIT} team messages in the last hour. Try again later.`);
  }
  const [jobCount, senderCount] = await Promise.all([
    db.auditLog.count({ where: { action: JOB_OFFICE_MESSAGE_AUDIT_ACTION, entity: "Job", entityId: jobId, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } } }),
    db.auditLog.count({ where: { action: JOB_OFFICE_MESSAGE_AUDIT_ACTION, userId: actorId, createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } } }),
  ]);
  if (jobCount >= JOB_MESSAGE_JOB_DAILY_LIMIT) throw new OfficeActionError(429, `This job's team has had ${JOB_MESSAGE_JOB_DAILY_LIMIT} messages today. Call the cleaner instead.`);
  if (senderCount >= JOB_MESSAGE_SENDER_HOURLY_LIMIT) throw new OfficeActionError(429, `You have sent ${JOB_MESSAGE_SENDER_HOURLY_LIMIT} team messages in the last hour. Try again later.`);
}

function fromPipeline(outcome: RecipientOutcome): JobMessageOutcome {
  return {
    userId: outcome.userId,
    name: outcome.name,
    transport: outcome.transport === "EMAIL" ? "INBOX" : outcome.transport,
    state: outcomeState(outcome.state),
    reason: outcomeReason(outcome.state, outcome.errorCode),
  };
}

/** One SMS, re-checking the job scope immediately before the provider is called. */
async function sendTeamSms(member: TeamMember, team: JobTeam, eventId: string, text: string, logSubject: string): Promise<JobMessageOutcome> {
  const base = { userId: member.id, name: recipientView(member).name, transport: "SMS" as const };
  const scope = await authorizeEntityRecipient(db, { userId: member.id, role: member.role, scope: { kind: "ENTITY", type: "JOB_ASSIGNED_CLEANER", id: team.jobId } });
  if (!scope.ok) return { ...base, state: "skipped", reason: outcomeReason("skipped", scope.errorCode) };
  if (!member.phone) return { ...base, state: "skipped", reason: outcomeReason("skipped", "missing_phone") };
  let result: JobMessageOutcome = { ...base, state: "accepted", reason: null };
  await dispatchNotificationOnce({ event: `${eventId}:SMS`, day: "office", recipientId: member.id, jobId: team.jobId }, async () => {
    const sent = await sendSmsDetailed(member.phone!, text);
    const state = sent.status === "disabled" ? "skipped" : sent.ok ? "provider_accepted" : "failed";
    result = { ...base, state: outcomeState(state), reason: outcomeReason(state, sent.ok ? null : `sms_${sent.status}`) };
    await db.notification.create({ data: {
      userId: member.id, jobId: team.jobId, channel: "SMS", subject: logSubject, body: text,
      status: sent.ok ? "SENT" : "FAILED", sentAt: sent.ok ? new Date() : undefined, errorMsg: sent.ok ? undefined : sent.error ?? "SMS delivery failed.",
    } });
  });
  return result;
}

export async function sendJobOfficeMessage(actor: OfficeActor, jobId: string, input: unknown, now: Date = new Date()): Promise<JobOfficeMessageResult> {
  const request = jobOfficeMessageSchema.parse(input);
  const replay = await replayOf(jobId, actor.id, request.idempotencyKey);
  if (replay) return replay;
  await enforceLimits(actor.id, jobId, now);

  const team = await loadJobTeam(jobId);
  if (team.members.length === 0) throw new OfficeActionError(409, NO_TEAM_REASON);
  const wanted = Array.from(new Set(request.recipientIds));
  const refused = wanted.filter((id) => !team.members.some((member) => member.id === id)).map((id) => ({ id, reason: "Not assigned to this job (only its assigned cleaners can be messaged here)." }));
  const recipients = team.members.filter((member) => wanted.includes(member.id));
  if (recipients.length === 0) throw new OfficeActionError(409, "None of the chosen people is assigned to this job any more. Reload the job.");

  const options = await transportOptions(recipients);
  const blocked = request.transports.find((transport) => !options[transport].available);
  if (blocked) throw new OfficeActionError(400, `${blocked === "INBOX" ? "Inbox" : blocked === "PUSH" ? "Push" : "SMS"} cannot be used: ${options[blocked].reason}`);
  const transports = normalizeJobTransports(request.transports);

  const controls = await getNotificationTypeControls();
  const wording = await loadNotificationWording(JOB_OFFICE_MESSAGE_TYPE);
  const values = { jobLabel: team.jobLabel, propertyName: team.propertyName, messageText: request.body };
  const inbox = wording.render("cleaner", "INBOX", values);
  const smsText = wording.render("cleaner", "SMS", values).body;
  const eventId = `job-office-message:${team.jobId}:${request.idempotencyKey}`;

  const officeTransports = transports.filter((transport): transport is "INBOX" | "PUSH" => transport !== "SMS");
  const pipeline = officeTransports.length
    ? await sendOfficeNotification({
        typeKey: JOB_OFFICE_MESSAGE_TYPE, eventKey: JOB_OFFICE_MESSAGE_TYPE, eventId,
        entity: { type: "Job", id: team.jobId }, actorId: actor.id,
        scopeType: "JOB_ASSIGNED_CLEANER", scopeId: () => team.jobId,
        category: "jobs", severity: "ACTION", jobId: team.jobId,
        subject: inbox.title, body: inbox.body, url: `/cleaner/jobs/${team.jobId}`,
        transports: officeTransports, recipients,
        respectsPreferences: typeRespectsPreferences(controls, JOB_OFFICE_MESSAGE_TYPE),
        disabledTransports: controls.disabledTransports[JOB_OFFICE_MESSAGE_TYPE] ?? [],
      })
    : [];
  const outcomes = pipeline.map(fromPipeline);
  if (transports.includes("SMS")) {
    for (const member of recipients) {
      outcomes.push(await sendTeamSms(member, team, eventId, smsText, inbox.title).catch((): JobMessageOutcome => ({ userId: member.id, name: recipientView(member).name, transport: "SMS", state: "failed", reason: outcomeReason("failed", "provider_outcome_unknown") })));
    }
  }

  const result: JobOfficeMessageResult = { outcomes, refused, transportsUsed: transports, replayed: false };
  await db.auditLog.create({ data: {
    userId: actor.id, jobId: team.jobId, action: JOB_OFFICE_MESSAGE_AUDIT_ACTION, entity: "Job", entityId: team.jobId,
    after: {
      actorRole: actor.role,
      idempotencyKey: request.idempotencyKey,
      body: request.body,
      title: inbox.title,
      recipientIds: recipients.map((member) => member.id),
      transportsUsed: transports,
      outcomes,
      refused,
      deliveryConfirmed: false,
    } as Prisma.InputJsonValue,
  } });
  if (request.rememberTransports) await saveTransportChoice(actor.id, "job_office_message", request.transports);
  return result;
}
