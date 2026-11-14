import "server-only";
/**
 * Sending safeguards: telling administrators. Through the notification
 * pipeline (lib/notifications/office-sends): an inbox notice and ONE email per
 * incident (stable event id `safeguard:<incident>`), to every active
 * administrator. The email is class ALERT at the gate: it passes pauses and
 * the per-person ceilings, but at most `alertEmailsPerHour` safeguard emails
 * go out in an hour in total, so the alert itself cannot loop. Queued is not
 * delivered: the outcomes are kept on the incident, never claimed as read.
 */
import { plainMessageEmail } from "@/lib/email-design/build-email";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveAppUrl } from "@/lib/app-url";
import { sendOfficeNotification, type OfficeRecipient, type RecipientOutcome } from "../office-sends";
import { getNotificationTypeControls } from "../type-controls";
import { loadNotificationWording } from "../wording/render";
import { SAFEGUARD_ALERT_TYPE } from "./classify";
import { LIMIT_GROUP_LABEL, type LimitGroup } from "./config";

export const SAFEGUARDS_PATH = "/v2/admin/notifications/safeguards";

const SCOPE_LABEL: Record<string, string> = {
  TYPE: "one notification type",
  RECIPIENT: "one person",
  SUBJECT: "one job or subject",
  JOB_NAME: "a scheduled job",
};

async function administrators(): Promise<OfficeRecipient[]> {
  return db.user.findMany({ where: { isActive: true, role: Role.ADMIN }, select: { id: true, role: true, name: true, email: true } });
}

function detailOf(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function send(incidentId: string, subject: string, body: string, reviewUrl: string, part: "tripped" | "worker-failing", extra: Record<string, string>): Promise<RecipientOutcome[]> {
  const recipients = await administrators();
  if (recipients.length === 0) return [];
  const wording = await loadNotificationWording(SAFEGUARD_ALERT_TYPE);
  const controls = await getNotificationTypeControls();
  return sendOfficeNotification({
    typeKey: SAFEGUARD_ALERT_TYPE, eventKey: SAFEGUARD_ALERT_TYPE, eventId: `safeguard:${incidentId}`,
    entity: { type: "OutboundSafeguardIncident", id: incidentId }, actorId: null,
    scopeType: "STAFF_MEMBER", scopeId: (recipient) => recipient.id,
    category: "account", severity: "CRITICAL", jobId: null,
    subject, body, url: reviewUrl,
    email: () => {
      const email = wording.render(part, "EMAIL", { title: subject, messageText: body, reviewUrl, ...extra });
      return { subject: email.subject ?? subject, html: email.html || plainMessageEmail({ subject, text: body }).html };
    },
    transports: ["INBOX", "EMAIL"], recipients,
    respectsPreferences: false,
    disabledTransports: controls.disabledTransports[SAFEGUARD_ALERT_TYPE] ?? [],
  });
}

async function markAlerted(incidentId: string, outcomes: RecipientOutcome[]) {
  const summary = outcomes.map((outcome) => ({ userId: outcome.userId, transport: outcome.transport, state: outcome.state, errorCode: outcome.errorCode ?? null }));
  const row = await db.outboundSafeguardIncident.findUnique({ where: { id: incidentId }, select: { detail: true } });
  await db.outboundSafeguardIncident.update({ where: { id: incidentId }, data: {
    alertedAt: new Date(),
    detail: { ...detailOf(row?.detail ?? null), alertOutcomes: summary } as Prisma.InputJsonValue,
  } });
}

/** Tell administrators about a newly opened incident. Called once, by its creator. */
export async function sendSafeguardAlert(incidentId: string): Promise<RecipientOutcome[]> {
  const incident = await db.outboundSafeguardIncident.findUnique({ where: { id: incidentId } });
  if (!incident || incident.alertedAt) return [];
  const detail = detailOf(incident.detail);
  const reviewUrl = resolveAppUrl(`${SAFEGUARDS_PATH}?incident=${encodeURIComponent(incident.id)}`);
  const wording = await loadNotificationWording(SAFEGUARD_ALERT_TYPE);
  let outcomes: RecipientOutcome[];
  if (incident.kind === "WORKER_FAILING") {
    const values = { jobName: incident.scopeKey, failures: String(incident.attemptCount), error: String(detail.error ?? "unknown").slice(0, 200) };
    const inbox = wording.render("worker-failing", "INBOX", values);
    outcomes = await send(incident.id, inbox.title ?? `Scheduled job keeps failing: ${incident.scopeKey}`, inbox.body, reviewUrl, "worker-failing", { jobName: incident.scopeKey });
  } else {
    const group = String(detail.transport ?? "EMAIL") as LimitGroup;
    const recipients = Array.isArray(incident.sampleRecipients) ? (incident.sampleRecipients as unknown[]).map(String).join(", ") : "";
    const inbox = wording.render("tripped", "INBOX", {
      label: incident.label,
      attempts: String(incident.attemptCount),
      transport: (LIMIT_GROUP_LABEL[group] ?? "outbound").toLowerCase(),
      minutes: String(detail.windowMinutes ?? ""),
      scope: SCOPE_LABEL[incident.scopeKind] ?? incident.scopeKind,
      threshold: String(detail.threshold ?? ""),
      recipients: recipients || "see the screen",
    });
    outcomes = await send(incident.id, inbox.title ?? `Sending paused: ${incident.label}`, inbox.body, reviewUrl, "tripped", {});
  }
  await markAlerted(incident.id, outcomes);
  return outcomes;
}

/**
 * A worker job failed `failures` times in a row: one incident (not pausing)
 * and one alert until the job succeeds again (resolveWorkerFailure).
 */
export async function raiseWorkerFailure(jobName: string, failures: number, error: string) {
  const { tripIncident } = await import("./breaker");
  return tripIncident({
    kind: "WORKER_FAILING", scopeKind: "JOB_NAME", scopeKey: jobName, label: `Scheduled job: ${jobName}`, pausesSending: false,
    attempts: failures, detail: { error: error.slice(0, 500), failures },
  });
}

/** The job succeeded: close its open failure incident (it never paused anything). */
export async function resolveWorkerFailure(jobName: string, now = new Date()) {
  await db.outboundSafeguardIncident.updateMany({
    where: { status: "ACTIVE", kind: "WORKER_FAILING", scopeKind: "JOB_NAME", scopeKey: jobName },
    data: { status: "RESOLVED", resolvedAt: now, resolutionNote: "The job succeeded again." },
  });
}
