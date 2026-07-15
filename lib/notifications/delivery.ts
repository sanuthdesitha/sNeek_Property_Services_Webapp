import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { canDeliverNotification } from "@/lib/notifications/preferences";
import { getAppSettings, type NotificationCategory } from "@/lib/settings";
import { type EmailAutoKind } from "@/lib/notifications/email-kinds";
import {
  audienceForRole,
  isChannelAllowed,
  type NotificationAudience,
} from "@/lib/notifications/audience-controls";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { sendWebPushToUser } from "@/lib/notifications/web-push";
import { resolveNotificationHrefForRole } from "@/lib/notifications/feed";
import { logger } from "@/lib/logger";

type Recipient = {
  id: string;
  role?: Role | null;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
};

type NotificationPayload = {
  subject: string;
  body: string;
};

type EmailPayload = {
  subject: string;
  html: string;
  logBody?: string;
};

type DeliveryInput = {
  recipients: Recipient[];
  category: NotificationCategory;
  jobId?: string | null;
  web: NotificationPayload;
  /** Optional explicit deep-link for the device push. Falls back to a role-based href. */
  url?: string | null;
  email?: EmailPayload | ((recipient: Recipient) => EmailPayload | null | undefined) | null;
  sms?: string | ((recipient: Recipient) => string | null | undefined) | null;
  /**
   * Which email-automation switch gates this send. If omitted we derive a
   * sensible kind from the category (below) — previously every send was
   * hardcoded to "report_delivery", so toggling that one switch silenced the
   * ENTIRE notification pipeline and toggling any other switch did nothing.
   */
  kind?: EmailAutoKind;
};

/** Fallback mapping from notification category → email-automation kind. */
const CATEGORY_TO_EMAIL_KIND: Record<NotificationCategory, EmailAutoKind> = {
  account: "admin_alert",
  jobs: "job_reminder",
  laundry: "admin_alert",
  cases: "case_alert",
  reports: "report_delivery",
  quotes: "admin_alert",
  shopping: "inventory_update",
  billing: "auto_invoice",
  approvals: "admin_alert",
  ical: "ical_alert",
};

function dedupeRecipients(recipients: Recipient[]) {
  return Array.from(
    new Map(
      recipients
        .filter((recipient) => typeof recipient.id === "string" && recipient.id.trim().length > 0)
        .map((recipient) => [recipient.id, recipient])
    ).values()
  );
}

async function getChannelPermissions(recipient: Recipient, category: NotificationCategory) {
  const [allowWeb, allowEmail, allowSms] = await Promise.all([
    canDeliverNotification({
      userId: recipient.id,
      category,
      channel: "WEB",
      role: recipient.role ?? null,
      hasPhone: Boolean(recipient.phone),
    }),
    canDeliverNotification({
      userId: recipient.id,
      category,
      channel: NotificationChannel.EMAIL,
      role: recipient.role ?? null,
      hasPhone: Boolean(recipient.phone),
    }),
    canDeliverNotification({
      userId: recipient.id,
      category,
      channel: NotificationChannel.SMS,
      role: recipient.role ?? null,
      hasPhone: Boolean(recipient.phone),
    }),
  ]);

  return { allowWeb, allowEmail, allowSms };
}

function resolveEmailPayload(input: DeliveryInput, recipient: Recipient) {
  return typeof input.email === "function" ? input.email(recipient) : input.email ?? null;
}

function resolveSmsBody(input: DeliveryInput, recipient: Recipient) {
  return typeof input.sms === "function" ? input.sms(recipient) : input.sms ?? null;
}

function resolveWebPushUrl(input: DeliveryInput, recipient: Recipient): string {
  const explicit = input.url?.trim();
  if (explicit) return explicit;
  // Derive a role-appropriate deep-link from the notification + jobId.
  return resolveNotificationHrefForRole(
    {
      jobId: input.jobId ?? null,
      subject: input.web.subject,
      body: input.web.body,
    },
    recipient.role ?? Role.CLIENT
  );
}

async function createWebNotification(input: DeliveryInput, recipient: Recipient) {
  // 1) In-app feed row (unchanged behaviour).
  await db.notification.create({
    data: {
      userId: recipient.id,
      jobId: input.jobId ?? null,
      channel: NotificationChannel.PUSH,
      subject: input.web.subject,
      body: input.web.body,
      status: NotificationStatus.SENT,
      sentAt: new Date(),
    },
  });

  // 2) Real device Web Push (WhatsApp-style). Best-effort: never block the
  // email/SMS path and never throw out of delivery. Only reached when the
  // recipient's web/push channel preference is enabled (allowWeb gate upstream).
  try {
    await sendWebPushToUser(recipient.id, {
      title: input.web.subject,
      body: input.web.body,
      url: resolveWebPushUrl(input, recipient),
      tag: input.jobId ? `job-${input.jobId}` : undefined,
    });
  } catch (err) {
    logger.warn({ err, userId: recipient.id }, "Web push dispatch failed (non-fatal)");
  }
}

async function sendEmailNotification(
  input: DeliveryInput,
  recipient: Recipient,
  emailPayload: EmailPayload,
  audience: NotificationAudience
) {
  const result = await sendEmailDetailed({
    kind: input.kind ?? CATEGORY_TO_EMAIL_KIND[input.category] ?? "admin_alert",
    to: recipient.email!,
    subject: emailPayload.subject,
    html: emailPayload.html,
    // Pass the already-resolved audience so the chokepoint skips a second lookup.
    audience,
  });

  await db.notification.create({
    data: {
      userId: recipient.id,
      jobId: input.jobId ?? null,
      channel: NotificationChannel.EMAIL,
      subject: emailPayload.subject,
      body: emailPayload.logBody ?? emailPayload.subject,
      status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: result.ok ? new Date() : undefined,
      errorMsg: result.ok ? undefined : result.error ?? "Email delivery failed.",
      externalId: result.externalId ?? undefined,
      deliveryStatus: result.ok ? "PENDING" : undefined,
    },
  });
}

async function sendSmsNotification(
  input: DeliveryInput,
  recipient: Recipient,
  smsBody: string,
  audience: NotificationAudience
) {
  const result = await sendSmsDetailed(recipient.phone!, smsBody, audience);
  if (result.status !== "sent" && result.status !== "failed") return;

  await db.notification.create({
    data: {
      userId: recipient.id,
      jobId: input.jobId ?? null,
      channel: NotificationChannel.SMS,
      subject: input.web.subject,
      body: smsBody,
      status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: result.ok ? new Date() : undefined,
      errorMsg: result.ok ? undefined : result.error ?? "SMS delivery failed.",
    },
  });
}

export async function deliverNotificationToRecipients(input: DeliveryInput) {
  const recipients = dedupeRecipients(input.recipients);

  // Audience-level controls apply on top of the per-user category preferences:
  // a silenced audience/channel blocks delivery even when the user opted in.
  // Web push maps to the "push" channel.
  const controls = (await getAppSettings()).notificationAudienceControls;

  for (const recipient of recipients) {
    const perms = await getChannelPermissions(recipient, input.category);
    const audience = audienceForRole(recipient.role ?? null);

    const allowWeb = perms.allowWeb && isChannelAllowed(controls, audience, "push");
    const allowEmail = perms.allowEmail && isChannelAllowed(controls, audience, "email");
    const allowSms = perms.allowSms && isChannelAllowed(controls, audience, "sms");

    if (allowWeb) {
      await createWebNotification(input, recipient);
    }

    const emailPayload = resolveEmailPayload(input, recipient);
    if (allowEmail && recipient.email && emailPayload?.subject && emailPayload.html) {
      await sendEmailNotification(input, recipient, emailPayload, audience);
    }

    const smsBody = resolveSmsBody(input, recipient);
    if (allowSms && recipient.phone && smsBody) {
      await sendSmsNotification(input, recipient, smsBody, audience);
    }
  }
}
