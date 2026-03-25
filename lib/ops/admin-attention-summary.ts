import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { NotificationChannel, NotificationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAdminAttentionSummary } from "@/lib/dashboard/immediate-attention";
import { renderEmailTemplate } from "@/lib/email-templates";
import { logger } from "@/lib/logger";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { isPastLocalDispatchTime, localDateKey } from "@/lib/ops/scheduled-dispatch";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";

const ADMIN_ATTENTION_STATE_KEY = "admin_attention_summary_dispatch_v1";

interface AdminAttentionDispatchState {
  lastDispatchDate: string | null;
}

function defaultDispatchState(): AdminAttentionDispatchState {
  return { lastDispatchDate: null };
}

async function readDispatchState(): Promise<AdminAttentionDispatchState> {
  const row = await db.appSetting.findUnique({ where: { key: ADMIN_ATTENTION_STATE_KEY } });
  if (!row?.value || typeof row.value !== "object" || Array.isArray(row.value)) {
    return defaultDispatchState();
  }
  const value = row.value as Record<string, unknown>;
  return {
    lastDispatchDate:
      typeof value.lastDispatchDate === "string" && value.lastDispatchDate.trim()
        ? value.lastDispatchDate.trim()
        : null,
  };
}

async function writeDispatchState(state: AdminAttentionDispatchState) {
  await db.appSetting.upsert({
    where: { key: ADMIN_ATTENTION_STATE_KEY },
    create: { key: ADMIN_ATTENTION_STATE_KEY, value: state as any },
    update: { value: state as any },
  });
}

function buildBreakdown(summary: Awaited<ReturnType<typeof getAdminAttentionSummary>>) {
  const approvalCount =
    summary.pendingPayRequests +
    summary.pendingTimeAdjustments +
    summary.pendingContinuations +
    summary.pendingClientApprovals +
    summary.pendingLaundryRescheduleDraft;

  const items = [
    { label: "Approvals / review items", count: approvalCount },
    { label: "Cleaner pay requests pending", count: summary.pendingPayRequests },
    { label: "Clock adjustments pending", count: summary.pendingTimeAdjustments },
    { label: "Pause / continue approvals pending", count: summary.pendingContinuations },
    { label: "Client approvals awaiting response", count: summary.pendingClientApprovals },
    { label: "Laundry reschedule drafts pending", count: summary.pendingLaundryRescheduleDraft },
    { label: "Unassigned jobs", count: summary.unassignedJobs },
    { label: "Open cases", count: summary.openCases },
    { label: "Overdue cases", count: summary.overdueCases },
    { label: "High-priority cases", count: summary.highCases },
    { label: "New cases in 24h", count: summary.newCases },
    { label: "Flagged laundry tasks", count: summary.flaggedLaundry },
  ];

  const breakdownHtml = `
    <ul style="margin:16px 0;padding-left:20px;">
      ${items
        .map(
          (item) =>
            `<li style="margin:0 0 8px 0;"><strong>${item.count}</strong> ${item.label.toLowerCase()}</li>`
        )
        .join("")}
    </ul>
  `;

  const nonZeroText = items
    .filter((item) => item.count > 0)
    .map((item) => `${item.label}: ${item.count}`)
    .join("; ");

  return {
    approvalCount,
    breakdownHtml,
    breakdownText:
      nonZeroText || "No immediate admin items require action right now. Please still check the dashboard.",
  };
}

export interface SendAdminAttentionSummaryOptions {
  now?: Date;
  ignoreWindow?: boolean;
  ignoreEnabled?: boolean;
}

export async function sendAdminAttentionSummary(options: SendAdminAttentionSummaryOptions = {}) {
  const now = options.now ?? new Date();
  const settings = await getAppSettings();
  const timezone = settings.timezone || "Australia/Sydney";
  const todayKey = localDateKey(now, timezone);

  if (!settings.scheduledNotifications.adminAttentionSummaryEnabled && !options.ignoreEnabled) {
    return {
      sentEmails: 0,
      sentSms: 0,
      admins: 0,
      attentionCount: 0,
      skipped: ["Admin attention summary is disabled in settings."],
    };
  }

  if (
    !options.ignoreWindow &&
    !isPastLocalDispatchTime(
      now,
      timezone,
      settings.scheduledNotifications.adminAttentionSummaryTime,
      8,
      0
    )
  ) {
    return {
      sentEmails: 0,
      sentSms: 0,
      admins: 0,
      attentionCount: 0,
      skipped: ["Before admin attention summary dispatch time."],
    };
  }

  const state = await readDispatchState();
  if (!options.ignoreWindow && state.lastDispatchDate === todayKey) {
    return {
      sentEmails: 0,
      sentSms: 0,
      admins: 0,
      attentionCount: 0,
      skipped: ["Admin attention summary already dispatched today."],
    };
  }

  const summary = await getAdminAttentionSummary();
  const breakdown = buildBreakdown(summary);
  const localNow = toZonedTime(now, timezone);
  const dateLabel = format(localNow, "EEEE, dd MMM yyyy");
  const admins = await db.user.findMany({
    where: { role: { in: ["ADMIN", "OPS_MANAGER"] }, isActive: true },
    select: { id: true, name: true, email: true, phone: true },
  });

  let sentEmails = 0;
  let sentSms = 0;
  for (const admin of admins) {
    const recipientName = admin.name?.trim() || admin.email?.split("@")[0] || "Admin";
    const emailTemplate = renderEmailTemplate(settings, "adminAttentionSummary", {
      recipientName,
      dateLabel,
      attentionCount: summary.attentionCount,
      approvalCount: breakdown.approvalCount,
      pendingPayRequests: summary.pendingPayRequests,
      pendingTimeAdjustments: summary.pendingTimeAdjustments,
      pendingContinuations: summary.pendingContinuations,
      pendingClientApprovals: summary.pendingClientApprovals,
      pendingLaundryRescheduleDraft: summary.pendingLaundryRescheduleDraft,
      unassignedJobCount: summary.unassignedJobs,
      openCaseCount: summary.openCases,
      overdueCaseCount: summary.overdueCases,
      highCaseCount: summary.highCases,
      newCaseCount: summary.newCases,
      flaggedLaundryCount: summary.flaggedLaundry,
      breakdownHtml: breakdown.breakdownHtml,
      breakdownText: breakdown.breakdownText,
      actionUrl: resolveAppUrl("/admin"),
      actionLabel: "Open admin dashboard",
    });
    const notificationTemplate = renderNotificationTemplate(settings, "adminAttentionSummary", {
      recipientName,
      dateLabel,
      attentionCount: summary.attentionCount,
      approvalCount: breakdown.approvalCount,
      pendingPayRequests: summary.pendingPayRequests,
      pendingTimeAdjustments: summary.pendingTimeAdjustments,
      pendingContinuations: summary.pendingContinuations,
      pendingClientApprovals: summary.pendingClientApprovals,
      pendingLaundryRescheduleDraft: summary.pendingLaundryRescheduleDraft,
      unassignedJobCount: summary.unassignedJobs,
      openCaseCount: summary.openCases,
      overdueCaseCount: summary.overdueCases,
      highCaseCount: summary.highCases,
      newCaseCount: summary.newCases,
      flaggedLaundryCount: summary.flaggedLaundry,
      breakdownText: breakdown.breakdownText,
      actionUrl: resolveAppUrl("/admin"),
      actionLabel: "Open admin dashboard",
    });

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

    if (admin.email) {
      const result = await sendEmailDetailed({
        to: admin.email,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
      });
      await db.notification.create({
        data: {
          userId: admin.id,
          channel: NotificationChannel.EMAIL,
          subject: emailTemplate.subject,
          body: notificationTemplate.webBody,
          status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
          sentAt: result.ok ? new Date() : undefined,
          errorMsg: result.ok ? undefined : result.error ?? "Admin attention summary email failed.",
        },
      });
      if (result.ok) sentEmails += 1;
    }

    if (admin.phone) {
      const result = await sendSmsDetailed(admin.phone, notificationTemplate.smsBody);
      if (result.status === "sent" || result.status === "failed") {
        await db.notification.create({
          data: {
            userId: admin.id,
            channel: NotificationChannel.SMS,
            subject: notificationTemplate.webSubject,
            body: notificationTemplate.smsBody,
            status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
            sentAt: result.ok ? new Date() : undefined,
            errorMsg: result.ok ? undefined : result.error ?? "Admin attention summary SMS failed.",
          },
        });
      }
      if (result.ok) sentSms += 1;
    }
  }

  if (!options.ignoreWindow) {
    await writeDispatchState({ lastDispatchDate: todayKey });
  }

  logger.info(
    {
      admins: admins.length,
      sentEmails,
      sentSms,
      attentionCount: summary.attentionCount,
      approvalCount: breakdown.approvalCount,
      unassignedJobs: summary.unassignedJobs,
      openCases: summary.openCases,
      flaggedLaundry: summary.flaggedLaundry,
      date: todayKey,
    },
    "Admin attention summary dispatched"
  );

  return {
    admins: admins.length,
    sentEmails,
    sentSms,
    attentionCount: summary.attentionCount,
    approvalCount: breakdown.approvalCount,
    unassignedJobs: summary.unassignedJobs,
    openCases: summary.openCases,
    flaggedLaundry: summary.flaggedLaundry,
    skipped: [] as string[],
  };
}
