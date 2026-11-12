import "server-only";
/**
 * What the Live ops "Notify client" confirm shows before anything is sent:
 * the client logins it would reach, the exact wording (the same function the
 * send uses), the transports switched off for the type in Notifications, and
 * whether a notice was already requested for this job today (organisation
 * day). A refusal the send would make (client switched notifications off, no
 * active login, no client) is returned as `blocked` with the send's reason.
 */
import { db } from "@/lib/db";
import { sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import type { NotificationTransport } from "./catalog-types";
import { OfficeActionError, clientDelayBody, resolveClientDelayTarget } from "./office-actions";
import { getNotificationTypeControls } from "./type-controls";

export type ClientDelayRequestRecord = { at: string; byName: string };

export type ClientDelayPreview = {
  jobId: string;
  propertyName: string | null;
  subject: string;
  body: string;
  etaMinutes: number | null;
  recipients: Array<{ id: string; name: string; email: string | null }>;
  /** The send's own refusal, when it would refuse; nothing can be sent. */
  blocked: string | null;
  switchedOff: NotificationTransport[];
  lastRequest: ClientDelayRequestRecord | null;
};

/**
 * Latest client delay notice requested per job since the start of today
 * (Sydney day, the organisation's day boundary used by Live ops).
 */
export async function latestClientDelayRequests(jobIds: string[], now: Date = new Date()): Promise<Map<string, ClientDelayRequestRecord>> {
  const out = new Map<string, ClientDelayRequestRecord>();
  if (jobIds.length === 0) return out;
  const rows = await db.auditLog.findMany({
    where: { action: "CLIENT_DELAY_NOTICE_SENT", entity: "Job", entityId: { in: jobIds }, createdAt: { gte: sydneyDayStart(sydneyTodayKey(now)) } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, createdAt: true, user: { select: { name: true, email: true } } },
  });
  for (const row of rows) {
    if (!row.entityId || out.has(row.entityId)) continue;
    out.set(row.entityId, { at: row.createdAt.toISOString(), byName: row.user?.name ?? row.user?.email ?? "An administrator" });
  }
  return out;
}

export async function previewClientDelayNotice(jobId: string, etaMinutes: number | null): Promise<ClientDelayPreview> {
  const subject = "Your clean is running late";
  const [controls, last] = await Promise.all([getNotificationTypeControls(), latestClientDelayRequests([jobId])]);
  const base = { jobId, subject, etaMinutes, switchedOff: controls.disabledTransports["client.delay_notice"] ?? [], lastRequest: last.get(jobId) ?? null };
  try {
    const { job, recipients } = await resolveClientDelayTarget(jobId);
    const propertyName = job.property?.name ?? null;
    return {
      ...base,
      propertyName,
      body: clientDelayBody(propertyName, etaMinutes),
      recipients: recipients.map((recipient) => ({ id: recipient.id, name: recipient.name ?? recipient.email ?? "Client login", email: recipient.email })),
      blocked: null,
    };
  } catch (error) {
    if (!(error instanceof OfficeActionError) || error.status === 404) throw error;
    const job = await db.job.findUnique({ where: { id: jobId }, select: { property: { select: { name: true } } } });
    const propertyName = job?.property?.name ?? null;
    return { ...base, propertyName, body: clientDelayBody(propertyName, etaMinutes), recipients: [], blocked: error.message };
  }
}
