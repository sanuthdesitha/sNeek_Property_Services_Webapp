import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";

export async function getActiveAdminRecipients() {
  return db.user.findMany({
    where: {
      role: { in: [Role.ADMIN, Role.OPS_MANAGER] },
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
    },
  });
}

export async function notifyAdminsByPush(input: {
  subject: string;
  body: string;
  jobId?: string | null;
}) {
  const admins = await getActiveAdminRecipients();
  if (admins.length === 0) return { count: 0 };

  await db.notification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      jobId: input.jobId ?? undefined,
      channel: NotificationChannel.PUSH,
      subject: input.subject,
      body: input.body,
      status: NotificationStatus.SENT,
      sentAt: new Date(),
    })),
  });

  return { count: admins.length };
}

export async function notifyAdminsByEmail(input: {
  subject: string;
  html: string;
}) {
  const settings = await getAppSettings();
  const emails = Array.from(
    new Set(
      [
        ...(settings.websiteContent.contact.recipientEmails ?? []),
        settings.accountsEmail,
      ]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );

  if (emails.length === 0) return { ok: false, count: 0 };

  const result = await sendEmailDetailed({
    to: emails,
    subject: input.subject,
    html: input.html,
  });

  return { ok: result.ok, count: emails.length, error: result.error };
}
