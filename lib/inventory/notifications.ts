import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { renderEmailTemplate } from "@/lib/email-templates";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
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
  webSubject: string;
  webBody: string;
  smsBody?: string;
  templateSubject: string;
  templateHtml: string;
  jobId?: string | null;
}) {
  const admins = await db.user.findMany({
    where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
    select: { id: true, email: true, phone: true, role: true },
  });

  for (const admin of admins) {
    const [allowWeb, allowEmail, allowSms] = await Promise.all([
      canDeliverNotification({ userId: admin.id, category: input.category, channel: "WEB", role: admin.role }),
      canDeliverNotification({ userId: admin.id, category: input.category, channel: NotificationChannel.EMAIL, role: admin.role }),
      canDeliverNotification({
        userId: admin.id,
        category: input.category,
        channel: NotificationChannel.SMS,
        role: admin.role,
        hasPhone: Boolean(admin.phone),
      }),
    ]);

    if (allowWeb) {
      await db.notification.create({
        data: {
          userId: admin.id,
          jobId: input.jobId ?? undefined,
          channel: NotificationChannel.PUSH,
          subject: input.webSubject,
          body: input.webBody,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
    }

    if (allowEmail && admin.email) {
      await sendEmailDetailed({ kind: "inventory_update",
        to: admin.email,
        subject: input.templateSubject,
        html: input.templateHtml,
        });
      }

    if (allowSms && admin.phone && input.smsBody) {
      const result = await sendSmsDetailed(admin.phone, input.smsBody);
      if (result.status === "sent" || result.status === "failed") {
        await db.notification.create({
          data: {
            userId: admin.id,
            jobId: input.jobId ?? undefined,
            channel: NotificationChannel.SMS,
            subject: input.webSubject,
            body: input.smsBody,
            status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
            sentAt: result.ok ? new Date() : undefined,
            errorMsg: result.ok ? undefined : result.error ?? "SMS delivery failed.",
          },
        });
      }
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
  const notificationTemplate = renderNotificationTemplate(settings, "shoppingRunSubmitted", {
    runTitle: input.run.name,
    submittedBy: input.actorLabel,
    paidBy: paidByDisplay,
    actualAmount: `$${Number(input.run.totals.actualTotalCost ?? 0).toFixed(2)}`,
    propertyNames,
  });

  await notifyAdmins({
    category: "shopping",
    webSubject: notificationTemplate.webSubject,
    webBody: notificationTemplate.webBody,
    smsBody: notificationTemplate.smsBody,
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
  const notificationTemplate = renderNotificationTemplate(settings, "stockRunRequested", {
    propertyName: input.run.property.name,
    requestedBy: input.actorLabel,
    runTitle: input.run.title,
  });

  await notifyAdmins({
    category: "shopping",
    webSubject: notificationTemplate.webSubject,
    webBody: notificationTemplate.webBody,
    smsBody: notificationTemplate.smsBody,
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
  const notificationTemplate = renderNotificationTemplate(settings, "stockRunSubmitted", {
    propertyName: input.run.property.name,
    submittedBy: input.actorLabel,
    runTitle: input.run.title,
    lineCount: String(input.run.lines?.length ?? 0),
  });

  await notifyAdmins({
    category: "shopping",
    webSubject: notificationTemplate.webSubject,
    webBody: notificationTemplate.webBody,
    smsBody: notificationTemplate.smsBody,
    templateSubject: template.subject,
    templateHtml: template.html,
  });
}

/**
 * A scanned stock count finished — tell the office what to buy.
 *
 * The shopping list itself needs no generating: it is derived from stock, so it
 * changed the instant the count was applied. What did not exist was the PUSH. A
 * cleaner who counts a cupboard at 9am and an admin who discovers the shortage
 * on Friday are looking at the same shortage, found four days late.
 *
 * Rendered through the SAME `buildShoppingListHtml` the manually emailed list
 * uses. Two renderers for one list would drift, and the version nobody
 * proofreads is the one that goes out automatically.
 *
 * SILENT WHEN THERE IS NOTHING TO BUY. A count that finds a full cupboard is
 * good news and not news; mailing "nothing needed" after every count is how a
 * useful alert becomes something people filter away.
 */
export async function notifyScanCountCompleted(input: {
  propertyId: string;
  propertyLabel: string;
  countedByLabel: string;
  changedCount: number;
  zeroedCount: number;
}): Promise<{ itemsNeeded: number }> {
  const { getShoppingListRows, groupShoppingListRows, buildShoppingListHtml } = await import(
    "@/lib/inventory/shopping-list-report"
  );

  const rows = await getShoppingListRows({ scope: input.propertyId });
  if (rows.length === 0) return { itemsNeeded: 0 };

  const settings = await getAppSettings();
  const subject = `${input.propertyLabel}: ${rows.length} item${
    rows.length === 1 ? "" : "s"
  } to restock`;
  const summary =
    `${input.countedByLabel} counted the stock at ${input.propertyLabel}. ` +
    `${input.changedCount} item${input.changedCount === 1 ? "" : "s"} changed` +
    (input.zeroedCount > 0 ? `, ${input.zeroedCount} now empty` : "") +
    ".";

  const html = buildShoppingListHtml({
    companyName: settings.companyName,
    scopeLabel: input.propertyLabel,
    grouped: groupShoppingListRows(rows),
  });

  await notifyAdmins({
    category: "shopping",
    webSubject: subject,
    webBody: summary,
    smsBody: `${subject}. ${summary}`,
    templateSubject: `${settings.companyName}: ${subject}`,
    templateHtml: `<p>${summary}</p>${html}`,
  });

  return { itemsNeeded: rows.length };
}
