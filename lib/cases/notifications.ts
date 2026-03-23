import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveAppUrl } from "@/lib/app-url";
import { renderEmailTemplate } from "@/lib/email-templates";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { canDeliverNotification } from "@/lib/notifications/preferences";
import { getAppSettings } from "@/lib/settings";

type CaseLike = {
  id: string;
  title: string;
  caseType: string;
  status: string;
  priority?: string | null;
  severity?: string | null;
  jobId?: string | null;
  clientId?: string | null;
  clientVisible?: boolean;
  job?: { id: string; jobNumber?: string | null } | null;
  client?: { id: string; name: string; email: string | null } | null;
  property?: { name: string; suburb?: string | null } | null;
};

function jobNumberForCase(input: CaseLike) {
  return input.job?.jobNumber || input.jobId || "-";
}

function propertyLabel(input: CaseLike) {
  return input.property?.name || "General case";
}

async function notifyAdmins(input: {
  caseItem: CaseLike;
  subject: string;
  body: string;
  templateKey: "caseCreated" | "caseUpdated";
  templateVariables: Record<string, string>;
}) {
  const [settings, admins] = await Promise.all([
    getAppSettings(),
    db.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      select: { id: true, email: true, phone: true, role: true },
    }),
  ]);

  const template = renderEmailTemplate(settings, input.templateKey, input.templateVariables);
  const notificationTemplate = renderNotificationTemplate(
    settings,
    input.templateKey,
    input.templateVariables
  );

  for (const admin of admins) {
    const [allowWeb, allowEmail] = await Promise.all([
      canDeliverNotification({ userId: admin.id, category: "cases", channel: "WEB", role: admin.role }),
      canDeliverNotification({ userId: admin.id, category: "cases", channel: NotificationChannel.EMAIL, role: admin.role }),
    ]);

    if (allowWeb) {
      await db.notification.create({
        data: {
          userId: admin.id,
          jobId: input.caseItem.jobId ?? undefined,
          channel: NotificationChannel.PUSH,
          subject: notificationTemplate.webSubject,
          body: notificationTemplate.webBody,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
    }

    if (allowEmail && admin.email) {
      await sendEmailDetailed({ to: admin.email, subject: template.subject, html: template.html });
    }
  }
}

async function notifyClientIfVisible(input: {
  caseItem: CaseLike;
  subject: string;
  body: string;
  updateNote: string;
}) {
  if (!input.caseItem.clientVisible || !input.caseItem.clientId) return;

  const [settings, linkedUsers] = await Promise.all([
    getAppSettings(),
    db.user.findMany({
      where: { clientId: input.caseItem.clientId, role: Role.CLIENT, isActive: true },
      select: { id: true, email: true, phone: true, role: true },
    }),
  ]);

  const fallbackEmails = new Set<string>();
  if (input.caseItem.client?.email) fallbackEmails.add(input.caseItem.client.email);
  for (const user of linkedUsers) {
    if (user.email) fallbackEmails.add(user.email);
  }

  const template = renderEmailTemplate(settings, "caseUpdated", {
    caseTitle: input.caseItem.title,
    caseType: input.caseItem.caseType.replace(/_/g, " "),
    status: input.caseItem.status.replace(/_/g, " "),
    updateNote: input.updateNote,
    actionUrl: resolveAppUrl("/client/cases"),
    actionLabel: "Open case",
  });
  const notificationTemplate = renderNotificationTemplate(settings, "caseUpdated", {
    caseTitle: input.caseItem.title,
    caseType: input.caseItem.caseType.replace(/_/g, " "),
    status: input.caseItem.status.replace(/_/g, " "),
    updateNote: input.updateNote,
  });

  for (const user of linkedUsers) {
    const [allowWeb, allowEmail] = await Promise.all([
      canDeliverNotification({ userId: user.id, category: "cases", channel: "WEB", role: user.role }),
      canDeliverNotification({ userId: user.id, category: "cases", channel: NotificationChannel.EMAIL, role: user.role }),
    ]);

    if (allowWeb) {
      await db.notification.create({
        data: {
          userId: user.id,
          jobId: input.caseItem.jobId ?? undefined,
          channel: NotificationChannel.PUSH,
          subject: notificationTemplate.webSubject,
          body: notificationTemplate.webBody,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
    }

    if (!allowEmail) {
      fallbackEmails.delete(user.email);
    }
  }

  if (fallbackEmails.size > 0) {
    await sendEmailDetailed({
      to: Array.from(fallbackEmails),
      subject: template.subject,
      html: template.html,
    });
  }
}

export async function notifyCaseCreated(input: { caseItem: CaseLike; actorLabel: string }) {
  const priority = input.caseItem.priority || input.caseItem.severity || "MEDIUM";
  await notifyAdmins({
    caseItem: input.caseItem,
    subject: "Case created",
    body: `${input.caseItem.title} opened for ${propertyLabel(input.caseItem)}`,
    templateKey: "caseCreated",
    templateVariables: {
      caseTitle: input.caseItem.title,
      caseType: input.caseItem.caseType.replace(/_/g, " "),
      propertyName: propertyLabel(input.caseItem),
      jobNumber: jobNumberForCase(input.caseItem),
      status: input.caseItem.status.replace(/_/g, " "),
      priority: String(priority).replace(/_/g, " "),
      actionUrl: resolveAppUrl(input.caseItem.jobId ? `/admin/jobs/${input.caseItem.jobId}` : "/admin/cases"),
      actionLabel: "Open case",
    },
  });
}

export async function notifyCaseUpdated(input: {
  caseItem: CaseLike;
  actorLabel: string;
  updateNote: string;
  notifyClient?: boolean;
}) {
  const subject = "Case updated";
  const body = `${input.caseItem.title} - ${input.updateNote}`;

  await notifyAdmins({
    caseItem: input.caseItem,
    subject,
    body,
    templateKey: "caseUpdated",
    templateVariables: {
      caseTitle: input.caseItem.title,
      caseType: input.caseItem.caseType.replace(/_/g, " "),
      status: input.caseItem.status.replace(/_/g, " "),
      updateNote: `${input.actorLabel}: ${input.updateNote}`,
      actionUrl: resolveAppUrl(input.caseItem.jobId ? `/admin/jobs/${input.caseItem.jobId}` : "/admin/cases"),
      actionLabel: "Open case",
    },
  });

  if (input.notifyClient !== false) {
    await notifyClientIfVisible({
      caseItem: input.caseItem,
      subject,
      body,
      updateNote: `${input.actorLabel}: ${input.updateNote}`,
    });
  }
}
