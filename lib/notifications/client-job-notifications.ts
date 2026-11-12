import { mobilePendingMarker } from "@/lib/notifications/mobile-outbox-marker";
import { db } from "@/lib/db";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { loadNotificationWording, type WordingRenderer } from "@/lib/notifications/wording/render";

export type ClientJobNotificationType =
  | "EN_ROUTE"
  | "EN_ROUTE_UPDATE"
  | "EN_ROUTE_ARRIVED"
  | "JOB_STARTED"
  | "JOB_COMPLETE";

type NotificationMessage = { subject: string; webBody: string; smsBody: string; emailSubject?: string; emailHtml?: string };

export const CLIENT_JOB_UPDATES_TYPE_KEY = "client.job_updates";

/** The wording part of each event (ETA update without an estimate has its own sentences). */
function eventPart(type: ClientJobNotificationType, eta: string | null): string {
  switch (type) {
    case "EN_ROUTE": return "en-route";
    case "EN_ROUTE_UPDATE": return eta ? "eta-update" : "eta-update-no-eta";
    case "EN_ROUTE_ARRIVED": return "arrived";
    case "JOB_STARTED": return "started";
    case "JOB_COMPLETE": return "complete";
  }
}

function formatEta(wording: WordingRenderer, etaMinutes: number | null | undefined): string | null {
  if (etaMinutes == null) return null;
  if (etaMinutes <= 1) return wording.render("eta-soon", "SMS", {}).body;
  const arrival = new Date(Date.now() + etaMinutes * 60 * 1000);
  const time = arrival.toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit", hour12: true });
  return wording.render("eta-minutes", "SMS", { etaMinutes, minutesWord: etaMinutes === 1 ? "minute" : "minutes", arrivalTime: time }).body;
}

/**
 * The message for one event, from the type's wording (catalog type
 * client.job_updates). Without an override it is byte-identical to the text
 * this function composed before the wording layer (parity test).
 */
export function buildClientJobMessage(
  wording: WordingRenderer,
  type: ClientJobNotificationType,
  companyName: string,
  propertyName: string,
  cleanerName: string,
  etaMinutes: number | null | undefined,
  liveTripUrl?: string | null,
  scheduleNote?: string | null
): NotificationMessage {
  const eta = formatEta(wording, etaMinutes);
  const hasEta = Boolean(eta);
  const trip = { tripUrl: liveTripUrl };
  const schedule = { scheduleNote };
  const values = {
    companyName, propertyName, cleanerName, eta,
    etaDash: wording.line("eta-dash", "INBOX", { eta }, hasEta),
    etaLine: wording.line("eta-line", "SMS", { eta }, hasEta),
    trackLine: wording.line("track-line", "SMS", trip, Boolean(liveTripUrl)),
    scheduleLine: wording.line("schedule-line", "SMS", schedule, Boolean(scheduleNote)),
    etaParagraph: wording.line("eta-paragraph", "EMAIL", { eta }, hasEta),
    scheduleParagraph: wording.line("schedule-paragraph", "EMAIL", schedule, Boolean(scheduleNote)),
    trackLink: wording.line("track-link", "EMAIL", trip, Boolean(liveTripUrl)),
    detailsLink: wording.line("details-link", "EMAIL", trip, Boolean(liveTripUrl)),
  };
  const part = eventPart(type, eta);
  const inbox = wording.render(part, "INBOX", values);
  const email = wording.render(part, "EMAIL", values);
  return { subject: inbox.title, webBody: inbox.body, smsBody: wording.render(part, "SMS", values).body, emailSubject: email.subject, emailHtml: email.html };
}

/** The schedule note for an ETA (null within 10 minutes of the start time). */
function scheduleNoteFor(wording: WordingRenderer, diff: number, startTime: string): string | null {
  if (diff > 10) return wording.render("running-late", "SMS", { minutes: Math.round(diff), startTime }).body;
  if (diff < -10) return wording.render("running-early", "SMS", { minutes: Math.abs(Math.round(diff)), startTime }).body;
  return null;
}

/** HTML escaping for the plain-text fallback below. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isEventEnabled(
  type: ClientJobNotificationType,
  pref: { notifyOnEnRoute: boolean; notifyOnJobStart: boolean; notifyOnJobComplete: boolean } | null
): boolean {
  if (!pref) return true;
  if (type === "EN_ROUTE" || type === "EN_ROUTE_UPDATE" || type === "EN_ROUTE_ARRIVED") return pref.notifyOnEnRoute;
  if (type === "JOB_STARTED") return pref.notifyOnJobStart;
  if (type === "JOB_COMPLETE") return pref.notifyOnJobComplete;
  return true;
}

function buildEmailPayload(
  recipientEmail: string,
  msg: NotificationMessage
): { subject: string; html: string; logBody: string } {
  // The SMS body is plain text being promoted into HTML — escape it.
  const html = msg.emailHtml ?? `<p>${esc(msg.smsBody)}</p>`;
  return { subject: msg.emailSubject ?? msg.subject, html, logBody: `Client notification sent to ${recipientEmail}` };
}

async function logPushNotification(input: { recipientUserId: string; jobId: string; subject: string; body: string }) {
  await db.notification.create({
    data: {
      userId: input.recipientUserId,
      jobId: input.jobId,
      externalId: mobilePendingMarker("jobs"),
      channel: NotificationChannel.PUSH,
      subject: input.subject,
      body: input.body,
      status: NotificationStatus.SENT,
      sentAt: new Date(),
    },
  });
}

async function logEmailNotification(input: {
  recipientUserId: string;
  jobId: string;
  subject: string;
  body: string;
  result: Awaited<ReturnType<typeof sendEmailDetailed>>;
}) {
  await db.notification.create({
    data: {
      userId: input.recipientUserId,
      jobId: input.jobId,
      channel: NotificationChannel.EMAIL,
      subject: input.subject,
      body: input.body,
      status: input.result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: input.result.ok ? new Date() : undefined,
      errorMsg: input.result.ok ? undefined : input.result.error ?? "Email delivery failed.",
      externalId: input.result.externalId ?? undefined,
      deliveryStatus: input.result.ok ? "PENDING" : undefined,
    },
  });
}

async function logSmsNotification(input: {
  recipientUserId: string;
  jobId: string;
  subject: string;
  body: string;
  result: Awaited<ReturnType<typeof sendSmsDetailed>>;
}) {
  if (input.result.status !== "sent" && input.result.status !== "failed") return;

  await db.notification.create({
    data: {
      userId: input.recipientUserId,
      jobId: input.jobId,
      channel: NotificationChannel.SMS,
      subject: input.subject,
      body: input.body,
      status: input.result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: input.result.ok ? new Date() : undefined,
      errorMsg: input.result.ok ? undefined : input.result.error ?? "SMS delivery failed.",
    },
  });
}

/**
 * Sends a job-status notification to the client associated with a job.
 * Respects the client's ClientNotificationPreference settings.
 * Fire-and-forget safe — catches and logs errors internally.
 */
export async function sendClientJobNotification(input: {
  jobId: string;
  type: ClientJobNotificationType;
  etaMinutes?: number | null;
}): Promise<void> {
  try {
    await dispatchClientJobNotification(input);
  } catch (err) {
    console.error("[sendClientJobNotification] error:", err);
  }
}

async function dispatchClientJobNotification(input: {
  jobId: string;
  type: ClientJobNotificationType;
  etaMinutes?: number | null;
}): Promise<void> {
  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: {
      id: true,
      jobType: true,
      startTime: true,
      property: {
        select: {
          name: true,
          suburb: true,
          client: {
            select: {
              notificationPref: true,
              users: {
                where: { role: Role.CLIENT, isActive: true },
                select: { id: true, name: true, email: true, phone: true },
              },
            },
          },
        },
      },
      assignments: {
        where: { removedAt: null, isPrimary: true },
        select: { user: { select: { name: true } } },
      },
    },
  });

  if (!job?.property?.client) return;

  const { client } = job.property;
  const pref = client.notificationPref;

  if (pref && !pref.notificationsEnabled) return;
  if (!isEventEnabled(input.type, pref)) return;

  const recipients = client.users;
  if (recipients.length === 0) return;

  const settings = await getAppSettings();
  const companyName = settings.companyName || "sNeek Property Services";
  const propertyName = job.property.suburb
    ? `${job.property.name} (${job.property.suburb})`
    : job.property.name;
  const cleanerName = job.assignments[0]?.user?.name ?? "Your cleaner";
  const channel = pref?.preferredChannel ?? "EMAIL";
  const liveTripUrl = resolveAppUrl(`/client/jobs/${job.id}`);

  const wording = await loadNotificationWording(CLIENT_JOB_UPDATES_TYPE_KEY);
  // Schedule comparison for EN_ROUTE notifications
  let scheduleNote: string | null = null;
  if ((input.type === "EN_ROUTE" || input.type === "EN_ROUTE_UPDATE") && input.etaMinutes != null && job.startTime) {
    const [h, m] = job.startTime.split(":").map(Number);
    const scheduledMinutes = h * 60 + m;
    const nowDate = new Date();
    const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
    const arrivalMinutes = nowMinutes + input.etaMinutes;
    const diff = arrivalMinutes - scheduledMinutes;
    scheduleNote = scheduleNoteFor(wording, diff, job.startTime);
  }

  const msg = buildClientJobMessage(wording, input.type, companyName, propertyName, cleanerName, input.etaMinutes, liveTripUrl, scheduleNote);

  const sendEmail = channel === "EMAIL" || channel === "BOTH";
  const sendSms = channel === "SMS" || channel === "BOTH";

  for (const recipient of recipients) {
    await logPushNotification({
      recipientUserId: recipient.id,
      jobId: input.jobId,
      subject: msg.subject,
      body: msg.webBody,
    });

    if (sendEmail && recipient.email) {
      const emailPayload = buildEmailPayload(recipient.email, msg);
      const result = await sendEmailDetailed({ kind: "client_job_update",
        to: recipient.email,
        subject: emailPayload.subject,
        html: emailPayload.html,
      });
      await logEmailNotification({
        recipientUserId: recipient.id,
        jobId: input.jobId,
        subject: emailPayload.subject,
        body: emailPayload.logBody,
        result,
      });
    }

    if (sendSms && recipient.phone) {
      const result = await sendSmsDetailed(recipient.phone, msg.smsBody);
      await logSmsNotification({
        recipientUserId: recipient.id,
        jobId: input.jobId,
        subject: msg.subject,
        body: msg.smsBody,
        result,
      });
    }
  }
}
