import { addDays, format } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { JobStatus, LaundryStatus, NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { renderEmailTemplate } from "@/lib/email-templates";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { getJobReference } from "@/lib/jobs/job-number";
import { compareJobsByPriority } from "@/lib/jobs/priority";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { extractLaundryTeamUserIds } from "@/lib/laundry/teams";
import { logger } from "@/lib/logger";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { isPastLocalDispatchTime, localDateKey } from "@/lib/ops/scheduled-dispatch";
import { getAppSettings } from "@/lib/settings";
import { resolveAppUrl } from "@/lib/app-url";

const DISPATCH_STATE_KEY = "tomorrow_prep_dispatch_v1";

type Recipient = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: Role;
};

type JobRow = {
  id: string;
  jobNumber: string;
  jobType: string;
  scheduledDate: Date;
  startTime: string | null;
  dueTime: string | null;
  priorityBucket: number;
  priorityReason: string | null;
  notes: string | null;
  internalNotes: string | null;
  property: {
    id: string;
    name: string;
    suburb: string | null;
    accessInfo: unknown;
  };
  assignments: Array<{
    user: Recipient;
  }>;
};

type CriticalStockRow = {
  propertyId: string;
  propertyName: string;
  itemName: string;
  onHand: number;
  reorderThreshold: number;
  unit: string;
};

type LaundryTaskRow = {
  id: string;
  status: LaundryStatus;
  pickupDate: Date;
  dropoffDate: Date;
  property: {
    id: string;
    name: string;
    suburb: string | null;
    accessInfo: unknown;
  };
};

interface DispatchState {
  lastDispatchDate: string | null;
}

function defaultDispatchState(): DispatchState {
  return { lastDispatchDate: null };
}

async function readDispatchState(): Promise<DispatchState> {
  const row = await db.appSetting.findUnique({ where: { key: DISPATCH_STATE_KEY } });
  if (!row?.value || typeof row.value !== "object" || Array.isArray(row.value)) {
    return defaultDispatchState();
  }
  const value = row.value as Record<string, unknown>;
  return {
    lastDispatchDate: typeof value.lastDispatchDate === "string" && value.lastDispatchDate.trim()
      ? value.lastDispatchDate.trim()
      : null,
  };
}

async function writeDispatchState(state: DispatchState) {
  await db.appSetting.upsert({
    where: { key: DISPATCH_STATE_KEY },
    create: { key: DISPATCH_STATE_KEY, value: state as any },
    update: { value: state as any },
  });
}

function buildUtcDayRange(date: Date, timezone: string) {
  const localDate = toZonedTime(date, timezone);
  const startUtc = fromZonedTime(
    new Date(localDate.getFullYear(), localDate.getMonth(), localDate.getDate(), 0, 0, 0, 0),
    timezone
  );
  const endUtc = fromZonedTime(
    new Date(localDate.getFullYear(), localDate.getMonth(), localDate.getDate() + 1, 0, 0, 0, 0),
    timezone
  );
  return { localDate, startUtc, endUtc };
}

function formatTimeWindow(startTime: string | null, dueTime: string | null) {
  if (startTime && dueTime) return `${startTime}-${dueTime}`;
  if (startTime) return `Start ${startTime}`;
  if (dueTime) return `Finish by ${dueTime}`;
  return "Time TBD";
}

function formatJobType(jobType: string) {
  return jobType.replace(/_/g, " ");
}

function joinNotes(job: JobRow) {
  const meta = parseJobInternalNotes(job.internalNotes);
  const values = [
    job.notes?.trim() || "",
    meta.internalNoteText?.trim() || "",
    meta.serviceContext?.accessInstructions?.trim() ? `Access: ${meta.serviceContext.accessInstructions.trim()}` : "",
    meta.serviceContext?.hazardNotes?.trim() ? `Hazards: ${meta.serviceContext.hazardNotes.trim()}` : "",
  ]
    .filter(Boolean)
    .map((value) => value.replace(/\s+/g, " ").trim());
  return Array.from(new Set(values)).join(" | ");
}

function buildJobSummaryParts(jobs: JobRow[]) {
  const htmlParts: string[] = [];
  const smsLines: string[] = [];

  jobs.forEach((job, index) => {
    const propertyLabel = `${job.property.name}${job.property.suburb ? ` (${job.property.suburb})` : ""}`;
    const priorityLabel = `P${job.priorityBucket || 4}`;
    const timing = formatTimeWindow(job.startTime, job.dueTime);
    const notes = joinNotes(job);
    const priorityReason = job.priorityReason?.trim() || "Standard priority";

    htmlParts.push(`
      <li style="margin:0 0 14px 0;">
        <strong>${priorityLabel} · ${job.jobNumber} · ${propertyLabel}</strong><br/>
        ${formatJobType(job.jobType)} · ${timing}<br/>
        <span><strong>Priority:</strong> ${priorityReason}</span>
        ${notes ? `<br/><span><strong>Notes:</strong> ${notes}</span>` : ""}
      </li>
    `);

    smsLines.push(
      `${index + 1}) ${priorityLabel} ${job.jobNumber} ${job.property.name} ${timing}. ${priorityReason}${notes ? ` Note: ${notes}` : ""}`
    );
  });

  let summaryText = smsLines.join(" ");
  if (summaryText.length > 1400) {
    let trimmed = "";
    let visibleCount = 0;
    for (const line of smsLines) {
      const candidate = `${trimmed}${trimmed ? " " : ""}${line}`;
      if (candidate.length > 1200) break;
      trimmed = candidate;
      visibleCount += 1;
    }
    const remaining = jobs.length - visibleCount;
    summaryText = `${trimmed}${remaining > 0 ? ` ... +${remaining} more. Check email for full list.` : ""}`;
  }

  return {
    html: `<ol style="padding-left:20px;margin:14px 0 0 0;">${htmlParts.join("")}</ol>`,
    text: summaryText,
  };
}

function buildInventorySummaryParts(rows: CriticalStockRow[]) {
  const byProperty = new Map<string, CriticalStockRow[]>();
  for (const row of rows) {
    const existing = byProperty.get(row.propertyId) ?? [];
    existing.push(row);
    byProperty.set(row.propertyId, existing);
  }

  const htmlParts: string[] = [];
  const textParts: string[] = [];
  for (const items of Array.from(byProperty.values())) {
    const propertyName = items[0]?.propertyName ?? "Property";
    const itemSummary = items
      .map((item: CriticalStockRow) => `${item.itemName} (${item.onHand}/${item.reorderThreshold} ${item.unit})`)
      .join(", ");
    htmlParts.push(
      `<li style="margin:0 0 12px 0;"><strong>${propertyName}</strong><br/>${itemSummary}</li>`
    );
    textParts.push(`${propertyName}: ${itemSummary}`);
  }

  let text = textParts.join(" ; ");
  if (text.length > 1200) {
    text = `${text.slice(0, 1160)}... Check email for full list.`;
  }

  return {
    html: `<ul style="padding-left:20px;margin:14px 0 0 0;">${htmlParts.join("")}</ul>`,
    text,
  };
}

function buildNoJobsSummaryParts() {
  return {
    html: "<p>No jobs are scheduled for tomorrow.</p><p>Please still check your schedule in case anything changes.</p>",
    text: "No jobs scheduled for tomorrow. Please still check your schedule in case anything changes.",
  };
}

function buildLaundrySummaryParts(tasks: LaundryTaskRow[], targetDate: Date, timezone: string) {
  const htmlParts: string[] = [];
  const smsLines: string[] = [];
  const targetKey = format(toZonedTime(targetDate, timezone), "yyyy-MM-dd");

  tasks.forEach((task, index) => {
    const pickupKey = format(toZonedTime(task.pickupDate, timezone), "yyyy-MM-dd");
    const dropoffKey = format(toZonedTime(task.dropoffDate, timezone), "yyyy-MM-dd");
    const actions: string[] = [];
    if (pickupKey === targetKey) actions.push("Pickup");
    if (dropoffKey === targetKey) actions.push("Drop-off");
    const actionLabel = actions.join(" + ") || "Task";
    const propertyLabel = `${task.property.name}${task.property.suburb ? ` (${task.property.suburb})` : ""}`;
    const timing = `Pickup ${format(toZonedTime(task.pickupDate, timezone), "dd MMM")} · Drop ${format(
      toZonedTime(task.dropoffDate, timezone),
      "dd MMM"
    )}`;

    htmlParts.push(`
      <li style="margin:0 0 14px 0;">
        <strong>${actionLabel} · ${propertyLabel}</strong><br/>
        ${timing}<br/>
        <span><strong>Status:</strong> ${String(task.status).replace(/_/g, " ")}</span>
      </li>
    `);
    smsLines.push(`${index + 1}) ${actionLabel} ${task.property.name}. ${timing}. ${String(task.status).replace(/_/g, " ")}`);
  });

  return {
    html: `<ol style="padding-left:20px;margin:14px 0 0 0;">${htmlParts.join("")}</ol>`,
    text: smsLines.join(" "),
  };
}

function buildNoLaundrySummaryParts() {
  return {
    html: "<p>No laundry pickups or drop-offs are scheduled for tomorrow.</p><p>Please still check your laundry schedule in case anything changes.</p>",
    text: "No laundry pickups or drop-offs scheduled for tomorrow. Please still check your schedule in case anything changes.",
  };
}

async function logPushNotification(userId: string, subject: string, body: string) {
  await db.notification.create({
    data: {
      userId,
      channel: NotificationChannel.PUSH,
      subject,
      body,
      status: NotificationStatus.SENT,
      sentAt: new Date(),
    },
  });
}

async function logEmailNotification(userId: string, subject: string, body: string, result: { ok: boolean; error?: string }) {
  await db.notification.create({
    data: {
      userId,
      channel: NotificationChannel.EMAIL,
      subject,
      body,
      status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: result.ok ? new Date() : undefined,
      errorMsg: result.ok ? undefined : result.error ?? "Email delivery failed.",
    },
  });
}

async function logSmsNotification(
  userId: string,
  subject: string,
  body: string,
  result: { ok: boolean; status: "sent" | "disabled" | "not_configured" | "failed"; error?: string }
) {
  if (result.status !== "sent" && result.status !== "failed") return;
  await db.notification.create({
    data: {
      userId,
      channel: NotificationChannel.SMS,
      subject,
      body,
      status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
      sentAt: result.ok ? new Date() : undefined,
      errorMsg: result.ok ? undefined : result.error ?? "SMS delivery failed.",
    },
  });
}

async function sendDirectSummaryNotification(input: {
  recipient: Recipient;
  webSubject: string;
  webBody: string;
  emailSubject: string;
  emailHtml: string;
  smsBody: string;
}) {
  await logPushNotification(input.recipient.id, input.webSubject, input.webBody);

  if (input.recipient.email) {
    const result = await sendEmailDetailed({
      to: input.recipient.email,
      subject: input.emailSubject,
      html: input.emailHtml,
    });
    await logEmailNotification(input.recipient.id, input.emailSubject, input.webBody, result);
  }

  if (input.recipient.phone) {
    const result = await sendSmsDetailed(input.recipient.phone, input.smsBody);
    await logSmsNotification(input.recipient.id, input.webSubject, input.smsBody, result);
  }
}

export async function dispatchTomorrowPrepSummaries(
  now = new Date(),
  options: { ignoreWindow?: boolean; ignoreEnabled?: boolean; useNextAvailableDate?: boolean } = {}
) {
  const settings = await getAppSettings();
  const timezone = settings.timezone || "Australia/Sydney";
  const localNow = toZonedTime(now, timezone);
  const todayKey = localDateKey(now, timezone);

  if (!settings.scheduledNotifications.tomorrowPrepEnabled && !options.ignoreEnabled) {
    return { skipped: "disabled_in_settings" as const };
  }

  if (
    !options.ignoreWindow &&
    !isPastLocalDispatchTime(now, timezone, settings.scheduledNotifications.tomorrowPrepTime, 17, 0)
  ) {
    return { skipped: "before_dispatch_window" as const };
  }

  const state = await readDispatchState();
  if (!options.ignoreWindow && state.lastDispatchDate === todayKey) {
    return { skipped: "already_dispatched" as const };
  }

  let targetLocal = addDays(localNow, 1);
  let targetRange = buildUtcDayRange(targetLocal, timezone);

  const loadJobsForRange = async (startUtc: Date, endUtc: Date) =>
    (await db.job.findMany({
      where: {
        scheduledDate: { gte: startUtc, lt: endUtc },
        status: {
          in: [JobStatus.ASSIGNED, JobStatus.IN_PROGRESS, JobStatus.PAUSED, JobStatus.WAITING_CONTINUATION_APPROVAL],
        },
      },
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        priorityBucket: true,
        priorityReason: true,
        notes: true,
        internalNotes: true,
        property: {
          select: {
            id: true,
            name: true,
            suburb: true,
            accessInfo: true,
          },
        },
        assignments: {
          where: { removedAt: null },
          select: {
            user: {
              select: { id: true, name: true, email: true, phone: true, role: true },
            },
          },
        },
      },
      orderBy: { scheduledDate: "asc" },
    })) as JobRow[];

  const jobs = await loadJobsForRange(targetRange.startUtc, targetRange.endUtc);
  const laundryTasks = (await db.laundryTask.findMany({
    where: {
      OR: [
        { pickupDate: { gte: targetRange.startUtc, lt: targetRange.endUtc } },
        { dropoffDate: { gte: targetRange.startUtc, lt: targetRange.endUtc } },
      ],
      status: {
        notIn: [LaundryStatus.DROPPED, LaundryStatus.SKIPPED_PICKUP],
      },
    },
    select: {
      id: true,
      status: true,
      pickupDate: true,
      dropoffDate: true,
      property: {
        select: {
          id: true,
          name: true,
          suburb: true,
          accessInfo: true,
        },
      },
    },
    orderBy: [{ pickupDate: "asc" }, { dropoffDate: "asc" }],
  })) as LaundryTaskRow[];

  const dateLabel = format(targetLocal, "EEEE, dd MMMM yyyy");

  const sortedJobs = [...jobs].sort(compareJobsByPriority);
  const tomorrowPropertyIds = Array.from(new Set(sortedJobs.map((job) => job.property.id)));

  const lowStocksRaw = tomorrowPropertyIds.length
    ? await db.propertyStock.findMany({
        where: {
          propertyId: { in: tomorrowPropertyIds },
          onHand: { lte: db.propertyStock.fields.reorderThreshold },
        },
        include: {
          item: { select: { name: true, unit: true } },
          property: { select: { id: true, name: true } },
        },
      })
    : [];

  const criticalStocks: CriticalStockRow[] = lowStocksRaw
    .filter((row) => Number(row.onHand) <= 0 || Number(row.onHand) < Math.max(1, Number(row.reorderThreshold)))
    .map((row) => ({
      propertyId: row.property.id,
      propertyName: row.property.name,
      itemName: row.item.name,
      onHand: Number(row.onHand),
      reorderThreshold: Number(row.reorderThreshold),
      unit: row.item.unit,
    }));

  const cleanerBuckets = new Map<string, { recipient: Recipient; jobs: JobRow[] }>();
  const allCleaners = await db.user.findMany({
    where: { role: Role.CLEANER, isActive: true },
    select: { id: true, name: true, email: true, phone: true, role: true },
    orderBy: { name: "asc" },
  });
  for (const recipient of allCleaners as Recipient[]) {
    cleanerBuckets.set(recipient.id, { recipient, jobs: [] });
  }

  const laundryBuckets = new Map<string, { recipient: Recipient; tasks: LaundryTaskRow[] }>();
  const allLaundryUsers = await db.user.findMany({
    where: { role: Role.LAUNDRY, isActive: true },
    select: { id: true, name: true, email: true, phone: true, role: true },
    orderBy: { name: "asc" },
  });
  for (const recipient of allLaundryUsers as Recipient[]) {
    laundryBuckets.set(recipient.id, { recipient, tasks: [] });
  }
  const laundryUserById = new Map(allLaundryUsers.map((user) => [user.id, user]));

  for (const job of sortedJobs) {
    for (const assignment of job.assignments) {
      const recipient = assignment.user;
      if (!recipient?.id) continue;
      const bucket = cleanerBuckets.get(recipient.id) ?? { recipient: recipient as Recipient, jobs: [] as JobRow[] };
      bucket.jobs.push(job);
      cleanerBuckets.set(recipient.id, bucket);
    }
  }

  for (const task of laundryTasks) {
    const explicitLaundryIds = extractLaundryTeamUserIds(task.property.accessInfo);
    const recipients: Recipient[] =
      explicitLaundryIds.length > 0
        ? explicitLaundryIds
            .map((id) => laundryUserById.get(id))
            .filter((row) => Boolean(row)) as Recipient[]
        : (allLaundryUsers as Recipient[]);

    for (const recipient of recipients) {
      const bucket = laundryBuckets.get(recipient.id) ?? { recipient, tasks: [] as LaundryTaskRow[] };
      bucket.tasks.push(task);
      laundryBuckets.set(recipient.id, bucket);
    }
  }

  const summaryTemplateSettings = {
    companyName: settings.companyName,
    logoUrl: settings.logoUrl,
    emailTemplates: settings.emailTemplates,
  };

  for (const bucket of Array.from(cleanerBuckets.values())) {
    const jobsForRecipient = [...bucket.jobs].sort(compareJobsByPriority);
    const summary =
      jobsForRecipient.length > 0 ? buildJobSummaryParts(jobsForRecipient) : buildNoJobsSummaryParts();
    const emailTemplate = renderEmailTemplate(summaryTemplateSettings, "tomorrowJobsSummary", {
      recipientName: bucket.recipient.name ?? "Cleaner",
      roleLabel: "Cleaner",
      dateLabel,
      jobCount: String(jobsForRecipient.length),
      summaryHtml: summary.html,
      summaryText: summary.text,
      actionUrl: resolveAppUrl("/cleaner/jobs"),
      actionLabel: "Open cleaner jobs",
    });
    const notificationTemplate = renderNotificationTemplate(settings, "tomorrowJobsSummary", {
      recipientName: bucket.recipient.name ?? "Cleaner",
      roleLabel: "Cleaner",
      dateLabel,
      jobCount: String(jobsForRecipient.length),
      summaryText: summary.text,
    });

    await sendDirectSummaryNotification({
      recipient: bucket.recipient,
      webSubject: notificationTemplate.webSubject,
      webBody: notificationTemplate.webBody,
      emailSubject: emailTemplate.subject,
      emailHtml: emailTemplate.html,
      smsBody: notificationTemplate.smsBody,
    });

    const recipientStocks = criticalStocks.filter((row) =>
      jobsForRecipient.some((job) => job.property.id === row.propertyId)
    );
    if (recipientStocks.length > 0) {
      const inventory = buildInventorySummaryParts(recipientStocks);
      const inventoryEmail = renderEmailTemplate(summaryTemplateSettings, "criticalInventoryTomorrow", {
        recipientName: bucket.recipient.name ?? "Cleaner",
        roleLabel: "Cleaner",
        dateLabel,
        propertyCount: String(new Set(recipientStocks.map((row) => row.propertyId)).size),
        itemCount: String(recipientStocks.length),
        inventoryHtml: inventory.html,
        inventoryText: inventory.text,
        actionUrl: resolveAppUrl("/cleaner/jobs"),
        actionLabel: "Review tomorrow jobs",
      });
      const inventoryNotification = renderNotificationTemplate(settings, "criticalInventoryTomorrow", {
        recipientName: bucket.recipient.name ?? "Cleaner",
        roleLabel: "Cleaner",
        dateLabel,
        propertyCount: String(new Set(recipientStocks.map((row) => row.propertyId)).size),
        itemCount: String(recipientStocks.length),
        inventoryText: inventory.text,
      });
      await sendDirectSummaryNotification({
        recipient: bucket.recipient,
        webSubject: inventoryNotification.webSubject,
        webBody: inventoryNotification.webBody,
        emailSubject: inventoryEmail.subject,
        emailHtml: inventoryEmail.html,
        smsBody: inventoryNotification.smsBody,
      });
    }
  }

  for (const bucket of Array.from(laundryBuckets.values())) {
    const tasksForRecipient = [...bucket.tasks].sort(
      (left, right) =>
        new Date(left.pickupDate).getTime() - new Date(right.pickupDate).getTime() ||
        new Date(left.dropoffDate).getTime() - new Date(right.dropoffDate).getTime()
    );
    const summary =
      tasksForRecipient.length > 0
        ? buildLaundrySummaryParts(tasksForRecipient, targetLocal, timezone)
        : buildNoLaundrySummaryParts();
    const emailTemplate = renderEmailTemplate(summaryTemplateSettings, "tomorrowLaundrySummary", {
      recipientName: bucket.recipient.name ?? "Laundry team",
      dateLabel,
      taskCount: String(tasksForRecipient.length),
      summaryHtml: summary.html,
      summaryText: summary.text,
      actionUrl: resolveAppUrl("/laundry"),
      actionLabel: "Open laundry portal",
    });
    const notificationTemplate = renderNotificationTemplate(settings, "tomorrowLaundrySummary", {
      recipientName: bucket.recipient.name ?? "Laundry team",
      dateLabel,
      taskCount: String(tasksForRecipient.length),
      summaryText: summary.text,
    });

    await sendDirectSummaryNotification({
      recipient: bucket.recipient,
      webSubject: notificationTemplate.webSubject,
      webBody: notificationTemplate.webBody,
      emailSubject: emailTemplate.subject,
      emailHtml: emailTemplate.html,
      smsBody: notificationTemplate.smsBody,
    });
  }

  if (criticalStocks.length > 0) {
    const adminRecipients = await db.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      select: { id: true, name: true, email: true, phone: true, role: true },
    });
    const inventory = buildInventorySummaryParts(criticalStocks);
    for (const recipient of adminRecipients) {
      const inventoryEmail = renderEmailTemplate(summaryTemplateSettings, "criticalInventoryTomorrow", {
        recipientName: recipient.name ?? "Admin",
        roleLabel: "Admin",
        dateLabel,
        propertyCount: String(new Set(criticalStocks.map((row) => row.propertyId)).size),
        itemCount: String(criticalStocks.length),
        inventoryHtml: inventory.html,
        inventoryText: inventory.text,
        actionUrl: resolveAppUrl("/admin/inventory"),
        actionLabel: "Open inventory",
      });
      const inventoryNotification = renderNotificationTemplate(settings, "criticalInventoryTomorrow", {
        recipientName: recipient.name ?? "Admin",
        roleLabel: "Admin",
        dateLabel,
        propertyCount: String(new Set(criticalStocks.map((row) => row.propertyId)).size),
        itemCount: String(criticalStocks.length),
        inventoryText: inventory.text,
      });
      await sendDirectSummaryNotification({
        recipient,
        webSubject: inventoryNotification.webSubject,
        webBody: inventoryNotification.webBody,
        emailSubject: inventoryEmail.subject,
        emailHtml: inventoryEmail.html,
        smsBody: inventoryNotification.smsBody,
      });
    }
  }

  if (!options.ignoreWindow) {
    await writeDispatchState({ lastDispatchDate: todayKey });
  }
  logger.info(
    {
      cleanerRecipients: cleanerBuckets.size,
      laundryRecipients: laundryBuckets.size,
      criticalStocks: criticalStocks.length,
      jobs: sortedJobs.length,
      date: todayKey,
      targetDate: targetRange.startUtc.toISOString().slice(0, 10),
    },
    "Tomorrow prep summaries dispatched"
  );

  return {
    cleanerRecipients: cleanerBuckets.size,
    laundryRecipients: laundryBuckets.size,
    criticalStocks: criticalStocks.length,
    jobs: sortedJobs.length,
    targetDate: targetRange.startUtc.toISOString().slice(0, 10),
    targetDateLabel: dateLabel,
  };
}
