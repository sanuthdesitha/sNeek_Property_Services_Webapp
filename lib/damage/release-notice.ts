import "server-only";
/**
 * "Tell the client" when a damage report is released (catalog
 * `client.damage_released`; owner default 2026-11-14, pending owner
 * confirmation: portal inbox and email ticked by default, SMS off).
 *
 * Before this a release was silent: the client only found the report in
 * Cases. The office now chooses the transports explicitly on each release:
 *   - INBOX: the client's portal inbox row only (never a phone or browser
 *     push), through the office pipeline;
 *   - EMAIL: through the office pipeline (queued, or the direct send while
 *     the email outbox transport is off, recorded as such);
 *   - SMS: through the SMS chokepoint, once per request key, re-checking the
 *     recipient scope immediately before the provider is called.
 * Recipients are the active CLIENT logins of the client that owns the job's
 * property (scope JOB_CLIENT_CONTACT, re-checked when queued and at
 * dispatch). The client's own "notifications off" choice is honoured.
 *
 * Every outcome is the transport's own state (queued, in the inbox, accepted
 * by the provider, skipped, failed); none means "read". The send is audited
 * with each state, once per request key.
 */
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { authorizeEntityRecipient } from "@/lib/notifications/recipient-scopes";
import { dispatchNotificationOnce } from "@/lib/notifications/dispatch-once";
import { sendSmsDetailed, getSmsProviderState } from "@/lib/notifications/sms";
import { sendOfficeNotification, type OfficeRecipient, type OfficeSendTransport } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls, typeRespectsPreferences } from "@/lib/notifications/type-controls";
import { defaultNotificationWording, loadNotificationWording, type WordingRenderer } from "@/lib/notifications/wording/render";
import type { DamageReleaseNoticePreview, DamageReleaseOutcome, DamageReleaseTransport } from "./release-notice-types";

export const DAMAGE_RELEASE_TYPE_KEY = "client.damage_released";
const AUDIT_ACTION = "DAMAGE_RELEASE_NOTICE_SENT";
/** States meaning a transport took the message (never proof it was read). */
const TAKEN_STATES = new Set<DamageReleaseOutcome["state"]>(["queued", "inbox_available", "provider_accepted", "requested", "already_requested"]);

export const damageReleaseNoticeSchema = z
  .object({
    transports: z.array(z.enum(["INBOX", "EMAIL", "SMS"])).max(3),
    idempotencyKey: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/),
  })
  .strict();

export type DamageReleaseNoticeRequest = z.infer<typeof damageReleaseNoticeSchema>;

export class DamageReleaseNoticeRefused extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type ReleaseRecipient = OfficeRecipient & { phone: string | null };

type ReleaseTarget = {
  report: { id: string; jobId: string; propertyName: string; itemCount: number; cleanDay: Date };
  client: { id: string; name: string };
  recipients: ReleaseRecipient[];
  /** Why nothing can be sent (no client, notifications off, no login), or null. */
  refusal: string | null;
};

async function resolveTarget(reportId: string): Promise<ReleaseTarget> {
  const report = await db.damageReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      jobId: true,
      _count: { select: { items: true } },
      job: { select: { scheduledDate: true } },
      property: {
        select: {
          name: true,
          client: {
            select: {
              id: true,
              name: true,
              notificationPref: { select: { notificationsEnabled: true } },
              users: { where: { role: Role.CLIENT, isActive: true }, select: { id: true, role: true, name: true, email: true, phone: true } },
            },
          },
        },
      },
    },
  });
  if (!report) throw new DamageReleaseNoticeRefused(404, "Not found");
  const client = report.property.client;
  const base = { id: report.id, jobId: report.jobId, propertyName: report.property.name, itemCount: report._count.items, cleanDay: report.job.scheduledDate };
  if (!client) return { report: base, client: { id: "", name: "" }, recipients: [], refusal: "This property has no client to tell." };
  const recipients = client.users.map((user) => ({ id: user.id, role: user.role, name: user.name, email: user.email, phone: user.phone ?? null }));
  const refusal =
    client.notificationPref && !client.notificationPref.notificationsEnabled
      ? "This client has switched off notifications."
      : recipients.length === 0
        ? "This client has no active portal login to tell."
        : null;
  return { report: base, client: { id: client.id, name: client.name }, recipients, refusal };
}

function itemCountText(count: number): string {
  return `${count} item${count === 1 ? "" : "s"}`;
}

function wordingValues(target: ReleaseTarget, timeZone: string) {
  return {
    propertyName: target.report.propertyName,
    itemCount: itemCountText(target.report.itemCount),
    cleanDate: formatInTimeZone(target.report.cleanDay, timeZone, "EEE d MMM"),
  };
}

function inboxWording(wording: WordingRenderer, values: ReturnType<typeof wordingValues>) {
  return wording.render("client", "INBOX", values);
}

/** What "Tell the client" shows before release: recipients, the exact wording, and any refusal. */
export async function previewDamageReleaseNotice(reportId: string): Promise<DamageReleaseNoticePreview> {
  const [target, settings, controls, sms] = await Promise.all([
    resolveTarget(reportId),
    getAppSettings().catch(() => null),
    getNotificationTypeControls().catch(() => null),
    getSmsProviderState().catch(() => null),
  ]);
  const wording = await loadNotificationWording(DAMAGE_RELEASE_TYPE_KEY).catch(() => defaultNotificationWording(DAMAGE_RELEASE_TYPE_KEY));
  const inbox = inboxWording(wording, wordingValues(target, settings?.timezone || "Australia/Sydney"));
  const switchedOff = (controls?.disabledTransports[DAMAGE_RELEASE_TYPE_KEY] ?? []).filter((transport): transport is DamageReleaseTransport => transport === "INBOX" || transport === "EMAIL" || transport === "SMS");
  return {
    clientName: target.client.name || null,
    recipients: target.recipients.map((recipient) => ({ id: recipient.id, name: recipient.name ?? recipient.email ?? "Client login", hasEmail: Boolean(recipient.email), hasPhone: Boolean(recipient.phone) })),
    refusal: target.refusal,
    title: inbox.title,
    body: inbox.body,
    smsConfigured: sms ? sms.provider !== "none" && Boolean(sms.configured) : null,
    switchedOff,
  };
}

/** Throws the refusal the send would give, before anything is released. */
export async function assertDamageReleaseNoticeSendable(reportId: string, transports: readonly DamageReleaseTransport[]): Promise<void> {
  if (transports.length === 0) return;
  const target = await resolveTarget(reportId);
  if (target.refusal) throw new DamageReleaseNoticeRefused(409, `${target.refusal} Untick the message to release without telling them.`);
}

async function sendSms(recipient: ReleaseRecipient, target: ReleaseTarget, eventId: string, text: string, subject: string): Promise<DamageReleaseOutcome> {
  const base = { userId: recipient.id, name: recipient.name ?? recipient.email ?? "Client login", transport: "SMS" as const };
  const scope = await authorizeEntityRecipient(db, { userId: recipient.id, role: recipient.role, scope: { kind: "ENTITY", type: "JOB_CLIENT_CONTACT", id: target.report.jobId } });
  if (!scope.ok) return { ...base, state: "skipped", errorCode: scope.errorCode };
  if (!recipient.phone) return { ...base, state: "skipped", errorCode: "missing_phone" };
  let outcome: DamageReleaseOutcome = { ...base, state: "already_requested", errorCode: null };
  await dispatchNotificationOnce({ event: `${eventId}:SMS`, day: "office", recipientId: recipient.id, jobId: target.report.jobId }, async () => {
    const sent = await sendSmsDetailed(recipient.phone!, text, undefined, { typeKey: DAMAGE_RELEASE_TYPE_KEY, eventKey: DAMAGE_RELEASE_TYPE_KEY, entityKey: `DamageReport:${target.report.id}`, recipientUserId: recipient.id });
    outcome = { ...base, state: sent.status === "disabled" || sent.status === "suppressed" ? "skipped" : sent.ok ? "provider_accepted" : "failed", errorCode: sent.ok ? null : `sms_${sent.status}` };
    await db.notification.create({
      data: {
        userId: recipient.id, jobId: target.report.jobId, channel: "SMS", subject, body: text,
        status: sent.ok ? "SENT" : "FAILED", sentAt: sent.ok ? new Date() : undefined, errorMsg: sent.ok ? undefined : sent.error ?? "SMS delivery failed.",
      },
    });
  });
  return outcome;
}

export type DamageReleaseNoticeResult = { outcomes: DamageReleaseOutcome[]; taken: boolean; replayed: boolean };

/**
 * Send the release message with the chosen transports. Call only after the
 * release has committed. A repeat of the same key is answered by the
 * pipeline's own records (nothing is sent twice) and is not audited again.
 */
export async function sendDamageReleaseNotice(input: { actorId: string; reportId: string; request: DamageReleaseNoticeRequest }): Promise<DamageReleaseNoticeResult> {
  const transports = Array.from(new Set(input.request.transports));
  if (transports.length === 0) return { outcomes: [], taken: false, replayed: false };
  const [target, settings, controls] = await Promise.all([resolveTarget(input.reportId), getAppSettings(), getNotificationTypeControls()]);
  if (target.refusal) throw new DamageReleaseNoticeRefused(409, target.refusal);
  const wording = await loadNotificationWording(DAMAGE_RELEASE_TYPE_KEY);
  const values = wordingValues(target, settings.timezone || "Australia/Sydney");
  const inbox = inboxWording(wording, values);
  const subject = inbox.title || `A damage report for ${target.report.propertyName} is ready`;
  const eventId = `damage-release:${target.report.id}:${input.request.idempotencyKey}`;
  const officeTransports: OfficeSendTransport[] = transports.flatMap((transport) => (transport === "INBOX" || transport === "EMAIL" ? [transport] : []));
  const outcomes: DamageReleaseOutcome[] = [];
  if (officeTransports.length > 0) {
    const sent = await sendOfficeNotification({
      typeKey: DAMAGE_RELEASE_TYPE_KEY,
      eventKey: DAMAGE_RELEASE_TYPE_KEY,
      eventId,
      entity: { type: "DamageReport", id: target.report.id },
      actorId: input.actorId,
      scopeType: "JOB_CLIENT_CONTACT",
      scopeId: () => target.report.jobId,
      category: "jobs",
      severity: "ACTION",
      jobId: target.report.jobId,
      subject,
      body: inbox.body,
      url: `/v2/client/damage/${target.report.id}`,
      email: (recipient) => {
        const email = wording.render("client", "EMAIL", { recipientName: recipient.name ?? "there", propertyName: target.report.propertyName, messageText: inbox.body });
        return { subject: email.subject || subject, html: email.html || email.body };
      },
      emailKind: "client_job_update",
      transports: officeTransports,
      recipients: target.recipients,
      respectsPreferences: typeRespectsPreferences(controls, DAMAGE_RELEASE_TYPE_KEY),
      disabledTransports: controls.disabledTransports[DAMAGE_RELEASE_TYPE_KEY] ?? [],
    });
    outcomes.push(...sent.map((outcome) => ({ userId: outcome.userId, name: outcome.name, transport: outcome.transport, state: outcome.state, errorCode: outcome.errorCode ?? null })));
  }
  if (transports.includes("SMS")) {
    const smsOff = (controls.disabledTransports[DAMAGE_RELEASE_TYPE_KEY] ?? []).includes("SMS");
    const text = wording.render("client", "SMS", values).body;
    for (const recipient of target.recipients) {
      if (smsOff) {
        outcomes.push({ userId: recipient.id, name: recipient.name ?? recipient.email ?? "Client login", transport: "SMS", state: "switched_off", errorCode: null });
        continue;
      }
      outcomes.push(await sendSms(recipient, target, eventId, text, subject).catch((): DamageReleaseOutcome => ({ userId: recipient.id, name: recipient.name ?? "Client login", transport: "SMS", state: "uncertain", errorCode: "provider_outcome_unknown" })));
    }
  }
  const taken = outcomes.some((outcome) => TAKEN_STATES.has(outcome.state));
  const earlier = await db.auditLog.findFirst({
    where: { action: AUDIT_ACTION, entity: "DamageReport", entityId: target.report.id, after: { path: ["idempotencyKey"], equals: input.request.idempotencyKey } },
    select: { id: true },
  });
  if (!earlier) {
    await db.auditLog.create({
      data: {
        userId: input.actorId, jobId: target.report.jobId, action: AUDIT_ACTION, entity: "DamageReport", entityId: target.report.id,
        after: {
          clientId: target.client.id, transports, idempotencyKey: input.request.idempotencyKey, deliveryConfirmed: false,
          outcomes: outcomes.map((outcome) => ({ userId: outcome.userId, transport: outcome.transport, state: outcome.state, errorCode: outcome.errorCode ?? null })),
        } as Prisma.InputJsonValue,
      },
    });
  }
  return { outcomes, taken, replayed: Boolean(earlier) };
}
