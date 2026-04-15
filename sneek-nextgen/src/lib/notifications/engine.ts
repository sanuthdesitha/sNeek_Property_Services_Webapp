import { prisma } from "@/lib/db/prisma";

interface NotificationContext {
  [key: string]: string | number | boolean | null;
}

function resolveTemplate(template: string | null, context: NotificationContext): string | null {
  if (!template) return null;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = context[key];
    return value !== undefined && value !== null ? String(value) : `{{${key}}}`;
  });
}

export async function sendNotification(
  eventKey: string,
  context: NotificationContext,
  options?: {
    userId?: string;
    jobId?: string;
    channel?: "EMAIL" | "SMS" | "PUSH";
  },
) {
  // Get the template
  const template = await prisma.notificationTemplate.findUnique({
    where: { eventKey },
  });

  if (!template) {
    console.warn(`[notifications] No template found for event: ${eventKey}`);
    return null;
  }

  // Check if notifications are enabled for this event/channel/role
  const preferences = await prisma.notificationPreference.findMany({
    where: {
      eventKey,
      enabled: true,
      ...(options?.channel && { channel: options.channel }),
    },
  });

  if (preferences.length === 0) {
    return { skipped: true, reason: "No enabled preferences" };
  }

  // Resolve template variables
  const emailSubject = resolveTemplate(template.emailSubject, context);
  const emailBody = resolveTemplate(template.emailBodyHtml ?? template.emailBodyText, context);
  const smsBody = resolveTemplate(template.smsBody, context);
  const pushTitle = resolveTemplate(template.pushTitle, context);
  const pushBody = resolveTemplate(template.pushBody, context);

  // Create notification records
  const notifications = [];

  for (const pref of preferences) {
    const body =
      pref.channel === "EMAIL"
        ? emailBody ?? ""
        : pref.channel === "SMS"
          ? smsBody ?? ""
          : pushBody ?? "";

    const subject =
      pref.channel === "EMAIL"
        ? emailSubject
        : pref.channel === "PUSH"
          ? pushTitle
          : null;

    if (!body) continue;

    const notification = await prisma.notification.create({
      data: {
        userId: options?.userId,
        jobId: options?.jobId,
        channel: pref.channel,
        subject: subject ?? undefined,
        body,
      },
    });

    notifications.push(notification);

    // Dispatch via the appropriate channel
    if (pref.channel === "EMAIL" && options?.userId) {
      await sendEmail(options.userId, subject ?? "", body);
    } else if (pref.channel === "SMS" && options?.userId) {
      await sendSMS(options.userId, body);
    } else if (pref.channel === "PUSH" && options?.userId) {
      await sendPush(options.userId, pushTitle ?? "", pushBody ?? "");
    }
  }

  // Log the notification
  await prisma.notificationLog.create({
    data: {
      eventKey,
      recipientEmail: (context.client_email as string) ?? null,
      recipientRole: preferences[0]?.recipientRole ?? "ADMIN",
      channel: options?.channel ?? "EMAIL",
      status: notifications.length > 0 ? "SENT" : "SKIPPED",
      subject: emailSubject ?? undefined,
    },
  });

  return { sent: notifications.length, notifications };
}

async function sendEmail(userId: string, subject: string, body: string) {
  // Implementation would use Resend API
  // For now, this is a placeholder
  console.log(`[email] To user ${userId}: ${subject}`);
}

async function sendSMS(userId: string, body: string) {
  // Implementation would use SMS provider
  console.log(`[sms] To user ${userId}: ${body}`);
}

async function sendPush(userId: string, title: string, body: string) {
  // Implementation would use Expo push notifications
  const devices = await prisma.userPushDevice.findMany({
    where: { userId, isActive: true },
  });
  console.log(`[push] To user ${userId} (${devices.length} devices): ${title}`);
}
