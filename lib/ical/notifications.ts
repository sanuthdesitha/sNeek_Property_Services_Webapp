import { format } from "date-fns";
import { addDays, startOfDay } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { NotificationChannel, NotificationStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { sendSmsDetailed } from "@/lib/notifications/sms";
import { resolveAppUrl } from "@/lib/app-url";
import type { IcalSyncSnapshot, IcalSyncSummary } from "@/lib/ical/sync";

function describeJobChange(
  before: IcalSyncSnapshot["jobs"][number]["before"],
  after: IcalSyncSnapshot["jobs"][number]["after"]
) {
  if (!before) return "New job created";
  const changes: string[] = [];
  if (before.scheduledDate !== after.scheduledDate) changes.push("date changed");
  if ((before.startTime ?? "") !== (after.startTime ?? "")) changes.push("start time changed");
  if ((before.dueTime ?? "") !== (after.dueTime ?? "")) changes.push("finish time changed");
  if ((before.estimatedHours ?? null) !== (after.estimatedHours ?? null)) changes.push("allocated hours changed");
  if (before.priorityBucket !== after.priorityBucket || (before.priorityReason ?? "") !== (after.priorityReason ?? "")) {
    changes.push("priority changed");
  }
  if (!changes.length) return "Linked job updated";
  return changes.join(", ");
}

function isUrgentScheduledDate(value: string, timezone: string, now = new Date()) {
  const localNow = toZonedTime(now, timezone);
  const today = startOfDay(localNow);
  const urgentCutoff = addDays(today, 2);
  const localDate = toZonedTime(new Date(value), timezone);
  return localDate >= today && localDate <= urgentCutoff;
}

function formatScheduledLabel(dateIso: string, startTime?: string | null, dueTime?: string | null, timezone = "Australia/Sydney") {
  const date = format(toZonedTime(new Date(dateIso), timezone), "dd MMM yyyy");
  return `${date}${startTime ? ` ${startTime}` : dueTime ? ` ${dueTime}` : ""}`;
}

export async function notifyAutoSyncChanges(input: {
  propertyId: string;
  propertyName: string;
  propertySuburb?: string | null;
  runId: string;
  summary: IcalSyncSummary;
  snapshot: IcalSyncSnapshot;
  now?: Date;
}) {
  const changeCount =
    input.summary.reservationsCreated +
    input.summary.reservationsUpdated +
    input.summary.jobsCreated +
    input.summary.jobsUpdated +
    input.summary.jobsSkippedConflict;

  if (changeCount <= 0) return { sentEmails: 0, sentSms: 0, admins: 0, urgent: false };

  const settings = await getAppSettings();
  const timezone = settings.timezone || "Australia/Sydney";
  const now = input.now ?? new Date();
  const jobs = input.snapshot.jobs.length
    ? await db.job.findMany({
        where: { id: { in: input.snapshot.jobs.map((row) => row.id) } },
        select: {
          id: true,
          jobNumber: true,
          scheduledDate: true,
          startTime: true,
          dueTime: true,
          status: true,
          priorityReason: true,
        },
      })
    : [];
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const changedJobs = input.snapshot.jobs.map((row) => {
    const job = jobById.get(row.id);
    const reference = job?.jobNumber || row.id;
    const scheduledLabel = formatScheduledLabel(
      row.after.scheduledDate,
      row.after.startTime,
      row.after.dueTime,
      timezone
    );
    const urgent = isUrgentScheduledDate(row.after.scheduledDate, timezone, now);
    return {
      reference,
      scheduledLabel,
      urgent,
      detail: describeJobChange(row.before, row.after),
      status: job?.status ?? row.after.status,
      priorityReason: job?.priorityReason ?? row.after.priorityReason,
    };
  });

  const urgentChanges = changedJobs.filter((job) => job.urgent);
  const urgent = urgentChanges.length > 0;
  const propertyLabel = `${input.propertyName}${input.propertySuburb ? ` (${input.propertySuburb})` : ""}`;
  const subject = `${urgent ? "IMPORTANT: " : ""}iCal sync changes - ${propertyLabel}`;
  const integrationsUrl = resolveAppUrl("/admin/integrations");
  const propertyUrl = resolveAppUrl(`/admin/properties/${input.propertyId}`);
  const summaryHtml = `
    <ul style="margin:16px 0;padding-left:20px;">
      <li><strong>${input.summary.reservationsCreated}</strong> reservations created</li>
      <li><strong>${input.summary.reservationsUpdated}</strong> reservations updated</li>
      <li><strong>${input.summary.jobsCreated}</strong> jobs created</li>
      <li><strong>${input.summary.jobsUpdated}</strong> jobs updated</li>
      <li><strong>${input.summary.jobsSkippedConflict}</strong> job conflicts skipped</li>
    </ul>
  `;
  const changedJobsHtml =
    changedJobs.length > 0
      ? `
        <div style="margin:18px 0;">
          <h3 style="margin:0 0 10px;">Changed jobs</h3>
          <ul style="margin:0;padding-left:20px;">
            ${changedJobs
              .slice(0, 12)
              .map(
                (job) => `
                  <li style="margin:0 0 8px;">
                    <strong>${job.reference}</strong> - ${job.scheduledLabel}
                    ${job.urgent ? ' <span style="color:#b91c1c;font-weight:700;">(near-term)</span>' : ""}
                    <div style="font-size:12px;color:#475569;">${job.detail}${job.priorityReason ? ` - ${job.priorityReason}` : ""}</div>
                  </li>
                `
              )
              .join("")}
          </ul>
        </div>
      `
      : "";
  const warningsHtml =
    input.summary.warnings.length > 0
      ? `
        <div style="margin:18px 0;">
          <h3 style="margin:0 0 10px;">Warnings</h3>
          <ul style="margin:0;padding-left:20px;">
            ${input.summary.warnings.map((warning) => `<li>${warning}</li>`).join("")}
          </ul>
        </div>
      `
      : "";
  const emailHtml = `
    <h2 style="margin:0 0 12px;">${urgent ? "Important iCal sync change detected" : "iCal sync change summary"}</h2>
    <p><strong>Property:</strong> ${propertyLabel}</p>
    <p><strong>Run:</strong> ${input.runId}</p>
    <p><strong>Synced at:</strong> ${format(toZonedTime(now, timezone), "dd MMM yyyy HH:mm")}</p>
    ${
      urgent
        ? `<p style="color:#b91c1c;font-weight:700;">Changes affect jobs scheduled today, tomorrow, or within the next 48 hours.</p>`
        : ""
    }
    ${summaryHtml}
    ${changedJobsHtml}
    ${warningsHtml}
    <p><a href="${propertyUrl}">Open property</a> - <a href="${integrationsUrl}">Open integrations</a></p>
  `;

  const smsText = urgent
    ? `IMPORTANT iCal sync for ${input.propertyName}: ${urgentChanges
        .slice(0, 3)
        .map((job) => `${job.reference} ${job.scheduledLabel}`)
        .join("; ")}`
    : null;

  const admins = await db.user.findMany({
    where: { role: { in: ["ADMIN", "OPS_MANAGER"] }, isActive: true },
    select: { id: true, name: true, email: true, phone: true },
  });

  let sentEmails = 0;
  let sentSms = 0;
  for (const admin of admins) {
    await db.notification.create({
      data: {
        userId: admin.id,
        channel: NotificationChannel.PUSH,
        subject,
        body: urgent
          ? `${urgentChanges.length} near-term job change(s) detected for ${propertyLabel}.`
          : `${changeCount} iCal sync change(s) detected for ${propertyLabel}.`,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      },
    });

    if (admin.email) {
      const result = await sendEmailDetailed({
        to: admin.email,
        subject,
        html: emailHtml,
      });
      await db.notification.create({
        data: {
          userId: admin.id,
          channel: NotificationChannel.EMAIL,
          subject,
          body: `${changeCount} iCal sync change(s) detected for ${propertyLabel}.`,
          status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
          sentAt: result.ok ? new Date() : undefined,
          errorMsg: result.ok ? undefined : result.error ?? "iCal sync alert email failed.",
        },
      });
      if (result.ok) sentEmails += 1;
    }

    if (smsText && admin.phone) {
      const result = await sendSmsDetailed(admin.phone, smsText);
      if (result.status === "sent" || result.status === "failed") {
        await db.notification.create({
          data: {
            userId: admin.id,
            channel: NotificationChannel.SMS,
            subject,
            body: smsText,
            status: result.ok ? NotificationStatus.SENT : NotificationStatus.FAILED,
            sentAt: result.ok ? new Date() : undefined,
            errorMsg: result.ok ? undefined : result.error ?? "iCal sync alert SMS failed.",
          },
        });
      }
      if (result.ok) sentSms += 1;
    }
  }

  logger.info(
    {
      propertyId: input.propertyId,
      runId: input.runId,
      admins: admins.length,
      sentEmails,
      sentSms,
      urgent,
    },
    "Auto iCal sync change alert sent"
  );

  return { sentEmails, sentSms, admins: admins.length, urgent };
}

