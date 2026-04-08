import { db } from "@/lib/db";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";

export type ClientJobNotificationType =
  | "EN_ROUTE"
  | "EN_ROUTE_UPDATE"
  | "EN_ROUTE_ARRIVED"
  | "JOB_STARTED"
  | "JOB_COMPLETE";

type NotificationMessage = { subject: string; webBody: string; smsBody: string; emailHtml?: string };

function formatEta(etaMinutes: number | null | undefined): string | null {
  if (etaMinutes == null) return null;
  if (etaMinutes <= 1) return "less than a minute away";
  const arrival = new Date(Date.now() + etaMinutes * 60 * 1000);
  const time = arrival.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
  return `about ${etaMinutes} minute${etaMinutes === 1 ? "" : "s"} away (arriving ~${time})`;
}

function buildLiveTripActionHtml(label: string, liveTripUrl?: string | null) {
  if (!liveTripUrl) return "";
  return `<p><a href="${liveTripUrl}">${label}</a></p>`;
}

function buildEnRouteSmsBody(companyName: string, propertyName: string, eta: string | null, liveTripLine: string) {
  if (eta) {
    return `Hi! Your ${companyName} cleaner is on the way to ${propertyName}. ETA: ${eta}.${liveTripLine}`;
  }
  return `Hi! Your ${companyName} cleaner is on the way to ${propertyName}.${liveTripLine}`;
}

function buildEtaUpdateSmsBody(companyName: string, propertyName: string, eta: string | null, liveTripLine: string) {
  if (eta) {
    return `ETA update: Your ${companyName} cleaner is now ${eta} from ${propertyName}.${liveTripLine}`;
  }
  return `Your ${companyName} cleaner is on the way to ${propertyName}.${liveTripLine}`;
}

function buildEnRouteEmailHtml(
  companyName: string,
  cleanerName: string,
  propertyName: string,
  eta: string | null,
  liveTripUrl?: string | null,
  scheduleNote?: string | null
) {
  const etaHtml = eta ? `<p><strong>ETA:</strong> ${eta}</p>` : "";
  const scheduleHtml = scheduleNote ? `<p style="color:#b45309">${scheduleNote}</p>` : "";
  return `<p>Hi! Your ${companyName} cleaner <strong>${cleanerName}</strong> is on the way to <strong>${propertyName}</strong>.</p>${etaHtml}${scheduleHtml}${buildLiveTripActionHtml("Track live", liveTripUrl)}`;
}

function buildEtaUpdateEmailHtml(
  companyName: string,
  cleanerName: string,
  propertyName: string,
  eta: string | null,
  liveTripUrl?: string | null,
  scheduleNote?: string | null
) {
  const etaHtml = eta
    ? `<p><strong>${cleanerName}</strong> is now ${eta} from <strong>${propertyName}</strong>.</p>`
    : `<p>Your ${companyName} cleaner is on the way to <strong>${propertyName}</strong>.</p>`;
  const scheduleHtml = scheduleNote ? `<p style="color:#b45309">${scheduleNote}</p>` : "";
  return `${etaHtml}${scheduleHtml}${buildLiveTripActionHtml("Track live", liveTripUrl)}`;
}

function buildArrivedEmailHtml(companyName: string, cleanerName: string, propertyName: string, liveTripUrl?: string | null) {
  return `<p>Your ${companyName} cleaner <strong>${cleanerName}</strong> has arrived at <strong>${propertyName}</strong> and will begin shortly.</p>${buildLiveTripActionHtml("View job details", liveTripUrl)}`;
}

function buildMessage(
  type: ClientJobNotificationType,
  companyName: string,
  propertyName: string,
  cleanerName: string,
  etaMinutes: number | null | undefined,
  liveTripUrl?: string | null,
  scheduleNote?: string | null
): NotificationMessage {
  const eta = formatEta(etaMinutes);
  const liveTripLine = liveTripUrl ? ` Track live: ${liveTripUrl}` : "";
  const scheduleLineSms = scheduleNote ? ` ${scheduleNote}` : "";

  const messages: Record<ClientJobNotificationType, NotificationMessage> = {
    EN_ROUTE: {
      subject: `${companyName}: Your cleaner is on the way`,
      webBody: eta
        ? `${cleanerName} is on the way to ${propertyName} — ETA ${eta}.`
        : `${cleanerName} is on the way to ${propertyName}.`,
      smsBody: buildEnRouteSmsBody(companyName, propertyName, eta, liveTripLine) + scheduleLineSms,
      emailHtml: buildEnRouteEmailHtml(companyName, cleanerName, propertyName, eta, liveTripUrl, scheduleNote),
    },
    EN_ROUTE_UPDATE: {
      subject: `${companyName}: Updated ETA for your clean`,
      webBody: eta
        ? `Updated ETA: ${cleanerName} is now ${eta} from ${propertyName}.`
        : `Your cleaner is on the way to ${propertyName}.`,
      smsBody: buildEtaUpdateSmsBody(companyName, propertyName, eta, liveTripLine) + scheduleLineSms,
      emailHtml: buildEtaUpdateEmailHtml(companyName, cleanerName, propertyName, eta, liveTripUrl, scheduleNote),
    },
    EN_ROUTE_ARRIVED: {
      subject: `${companyName}: Your cleaner has arrived`,
      webBody: `${cleanerName} has arrived at ${propertyName}.`,
      smsBody: `Hi! Your ${companyName} cleaner has arrived at ${propertyName}.${liveTripLine}`,
      emailHtml: buildArrivedEmailHtml(companyName, cleanerName, propertyName, liveTripUrl),
    },
    JOB_STARTED: {
      subject: `${companyName}: Cleaning has started`,
      webBody: `${cleanerName} has started cleaning at ${propertyName}.`,
      smsBody: `Hi! Your ${companyName} cleaner has started cleaning at ${propertyName}.`,
      emailHtml: `<p>Your ${companyName} cleaner <strong>${cleanerName}</strong> has started cleaning at <strong>${propertyName}</strong>.</p>`,
    },
    JOB_COMPLETE: {
      subject: `${companyName}: Cleaning is complete`,
      webBody: `The cleaning at ${propertyName} is complete.`,
      smsBody: `Hi! The cleaning at ${propertyName} is complete. Thank you for choosing ${companyName}!`,
      emailHtml: `<p>The cleaning at <strong>${propertyName}</strong> is complete.</p><p>Thank you for choosing <strong>${companyName}</strong>.</p>`,
    },
  };

  return messages[type];
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
  const html = msg.emailHtml ?? `<p>${msg.smsBody}</p>`;
  return { subject: msg.subject, html, logBody: `Client notification sent to ${recipientEmail}` };
}

async function logPushNotification(input: { recipientUserId: string; jobId: string; subject: string; body: string }) {
  await db.notification.create({
    data: {
      userId: input.recipientUserId,
      jobId: input.jobId,
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

  // Schedule comparison for EN_ROUTE notifications
  let scheduleNote: string | null = null;
  if ((input.type === "EN_ROUTE" || input.type === "EN_ROUTE_UPDATE") && input.etaMinutes != null && job.startTime) {
    const [h, m] = job.startTime.split(":").map(Number);
    const scheduledMinutes = h * 60 + m;
    const nowDate = new Date();
    const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
    const arrivalMinutes = nowMinutes + input.etaMinutes;
    const diff = arrivalMinutes - scheduledMinutes;
    if (diff > 10) scheduleNote = `Note: Your cleaner is running approximately ${Math.round(diff)} minutes behind the scheduled start time of ${job.startTime}.`;
    else if (diff < -10) scheduleNote = `Your cleaner is expected to arrive about ${Math.abs(Math.round(diff))} minutes before the scheduled time of ${job.startTime}.`;
  }

  const msg = buildMessage(input.type, companyName, propertyName, cleanerName, input.etaMinutes, liveTripUrl, scheduleNote);

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
      const result = await sendEmailDetailed({
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
