import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { canDeliverNotification } from "@/lib/notifications/preferences";
import { type NotificationCategory } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";

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
  email?: EmailPayload | ((recipient: Recipient) => EmailPayload | null | undefined) | null;
  sms?: string | ((recipient: Recipient) => string | null | undefined) | null;
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

async function createWebNotification(input: DeliveryInput, recipient: Recipient) {
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
}

async function sendEmailNotification(input: DeliveryInput, recipient: Recipient, emailPayload: EmailPayload) {
  const result = await sendEmailDetailed({
    to: recipient.email!,
    subject: emailPayload.subject,
    html: emailPayload.html,
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

async function sendSmsNotification(input: DeliveryInput, recipient: Recipient, smsBody: string) {
  const result = await sendSmsDetailed(recipient.phone!, smsBody);
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

  for (const recipient of recipients) {
    const { allowWeb, allowEmail, allowSms } = await getChannelPermissions(recipient, input.category);

    if (allowWeb) {
      await createWebNotification(input, recipient);
    }

    const emailPayload = resolveEmailPayload(input, recipient);
    if (allowEmail && recipient.email && emailPayload?.subject && emailPayload.html) {
      await sendEmailNotification(input, recipient, emailPayload);
    }

    const smsBody = resolveSmsBody(input, recipient);
    if (allowSms && recipient.phone && smsBody) {
      await sendSmsNotification(input, recipient, smsBody);
    }
  }
}
