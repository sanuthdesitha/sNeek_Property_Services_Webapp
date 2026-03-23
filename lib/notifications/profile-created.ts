import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { canDeliverNotification } from "@/lib/notifications/preferences";
import { getAppSettings } from "@/lib/settings";
import { renderEmailTemplate } from "@/lib/email-templates";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { resolveAppUrl } from "@/lib/app-url";

export async function notifyAdminsOfNewProfile(input: {
  userId: string;
  userName: string;
  email: string;
  role: string;
  createdVia: string;
  createdAt?: Date;
}) {
  const [settings, admins] = await Promise.all([
    getAppSettings(),
    db.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      select: { id: true, email: true, phone: true, role: true },
    }),
  ]);

  const createdAt = (input.createdAt ?? new Date()).toLocaleString("en-AU", {
    timeZone: settings.timezone || "Australia/Sydney",
  });

  const template = renderEmailTemplate(settings, "newProfileCreated", {
    userName: input.userName,
    email: input.email,
    role: input.role.replace(/_/g, " "),
    createdVia: input.createdVia,
    createdAt,
    actionUrl: resolveAppUrl(`/admin/users?q=${encodeURIComponent(input.email)}`),
    actionLabel: "Open account",
  });
  const notificationTemplate = renderNotificationTemplate(settings, "newProfileCreated", {
    userName: input.userName,
    email: input.email,
    role: input.role.replace(/_/g, " "),
    createdVia: input.createdVia,
    createdAt,
  });

  for (const admin of admins) {
    const [allowWeb, allowEmail] = await Promise.all([
      canDeliverNotification({
        userId: admin.id,
        category: "account",
        channel: "WEB",
        role: admin.role,
      }),
      canDeliverNotification({
        userId: admin.id,
        category: "account",
        channel: NotificationChannel.EMAIL,
        role: admin.role,
      }),
    ]);

    if (allowWeb) {
      await db.notification.create({
        data: {
          userId: admin.id,
          channel: NotificationChannel.PUSH,
          subject: notificationTemplate.webSubject,
          body: notificationTemplate.webBody,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
    }

    if (allowEmail && admin.email) {
      await sendEmailDetailed({
        to: admin.email,
        subject: template.subject,
        html: template.html,
      });
    }
  }
}
