import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { renderEmailTemplate } from "@/lib/email-templates";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { canDeliverNotification } from "@/lib/notifications/preferences";
import { getAppSettings } from "@/lib/settings";
import type { ShoppingRunRecord } from "@/lib/inventory/shopping-runs";

type StockRunLike = {
  id: string;
  title: string;
  property: { id: string; name: string; suburb: string | null };
  requestedBy?: { name: string | null; email: string } | null;
  lines?: Array<unknown>;
};

async function notifyAdmins(input: {
  category: "shopping";
  subject: string;
  body: string;
  templateSubject: string;
  templateHtml: string;
  jobId?: string | null;
}) {
  const admins = await db.user.findMany({
    where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
    select: { id: true, email: true, role: true },
  });

  for (const admin of admins) {
    const [allowWeb, allowEmail] = await Promise.all([
      canDeliverNotification({ userId: admin.id, category: input.category, channel: "WEB", role: admin.role }),
      canDeliverNotification({ userId: admin.id, category: input.category, channel: NotificationChannel.EMAIL, role: admin.role }),
    ]);

    if (allowWeb) {
      await db.notification.create({
        data: {
          userId: admin.id,
          jobId: input.jobId ?? undefined,
          channel: NotificationChannel.PUSH,
          subject: input.subject,
          body: input.body,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
    }

    if (allowEmail && admin.email) {
      await sendEmailDetailed({
        to: admin.email,
        subject: input.templateSubject,
        html: input.templateHtml,
      });
    }
  }
}

export async function notifyShoppingRunSubmitted(input: {
  run: ShoppingRunRecord;
  actorLabel: string;
}) {
  const settings = await getAppSettings();
  const paidByDisplay =
    input.run.payment.paidByName?.trim() ||
    input.run.payment.paidByScope.replace(/_/g, " ");
  const propertyNames = input.run.totals.byProperty.map((row) => row.propertyName).join(", ") || "Mixed properties";
  const template = renderEmailTemplate(settings, "shoppingRunSubmitted", {
    runTitle: input.run.name,
    submittedBy: input.actorLabel,
    paidBy: paidByDisplay,
    actualAmount: `$${Number(input.run.totals.actualTotalCost ?? 0).toFixed(2)}`,
    propertyNames,
    actionUrl: "/admin/shopping-runs",
    actionLabel: "Open shopping runs",
  });

  await notifyAdmins({
    category: "shopping",
    subject: "Shopping run submitted",
    body: `${input.run.name} submitted by ${input.actorLabel}`,
    templateSubject: template.subject,
    templateHtml: template.html,
  });
}

export async function notifyStockRunRequested(input: {
  run: StockRunLike;
  actorLabel: string;
}) {
  const settings = await getAppSettings();
  const template = renderEmailTemplate(settings, "stockRunRequested", {
    propertyName: input.run.property.name,
    requestedBy: input.actorLabel,
    actionUrl: "/admin/stock-runs",
    actionLabel: "Open stock counts",
  });

  await notifyAdmins({
    category: "shopping",
    subject: "Stock count requested",
    body: `${input.run.property.name}: ${input.actorLabel} started ${input.run.title}`,
    templateSubject: template.subject,
    templateHtml: template.html,
  });
}

export async function notifyStockRunSubmitted(input: {
  run: StockRunLike;
  actorLabel: string;
}) {
  const settings = await getAppSettings();
  const template = renderEmailTemplate(settings, "stockRunSubmitted", {
    propertyName: input.run.property.name,
    submittedBy: input.actorLabel,
    lineCount: String(input.run.lines?.length ?? 0),
    actionUrl: "/admin/stock-runs",
    actionLabel: "Review stock run",
  });

  await notifyAdmins({
    category: "shopping",
    subject: "Stock count submitted",
    body: `${input.run.property.name}: ${input.actorLabel} submitted ${input.run.title}`,
    templateSubject: template.subject,
    templateHtml: template.html,
  });
}
