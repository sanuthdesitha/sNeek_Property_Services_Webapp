import { NotificationChannel, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { notifyAdminsByEmail, notifyAdminsByPush } from "@/lib/notifications/admin-alerts";
import { loadNotificationWording } from "@/lib/notifications/wording/render";

const ALERT_SUBJECT = "Safety check-in overdue";
const ACTIVE_STATUSES = ["IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"] as const;

export async function runSafetyCheckinAlerts(now = new Date()) {
  const cutoff = new Date(now.getTime() - 90 * 60 * 1000);

  const overdueJobs = await db.job.findMany({
    where: {
      requiresSafetyCheckin: true,
      safetyCheckinAt: null,
      gpsCheckInAt: { not: null, lte: cutoff },
      status: { in: ACTIVE_STATUSES as any },
    },
    select: {
      id: true,
      jobNumber: true,
      gpsCheckInAt: true,
      property: {
        select: {
          name: true,
          suburb: true,
        },
      },
      assignments: {
        where: { removedAt: null },
        select: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
  });

  if (overdueJobs.length === 0) {
    return { scanned: 0, alerted: 0 };
  }

  const existingAlerts = await db.notification.findMany({
    where: {
      jobId: { in: overdueJobs.map((job) => job.id) },
      channel: NotificationChannel.PUSH,
      subject: ALERT_SUBJECT,
    },
    select: { jobId: true },
    distinct: ["jobId"],
  });
  const alertedJobIds = new Set(existingAlerts.map((row) => row.jobId).filter(Boolean));

  let alerted = 0;
  const wording = await loadNotificationWording("office.field_alerts");
  for (const job of overdueJobs) {
    if (alertedJobIds.has(job.id)) continue;

    const cleanerNames = job.assignments
      .map((assignment) => assignment.user.name ?? assignment.user.email)
      .filter(Boolean)
      .join(", ");
    const minutesLate = Math.max(
      90,
      Math.round((now.getTime() - new Date(job.gpsCheckInAt ?? cutoff).getTime()) / 60_000)
    );
    const propertyLabel = [job.property?.name, job.property?.suburb].filter(Boolean).join(" · ");
    const alert = wording.render("safety-overdue", "INBOX", {
      place: propertyLabel || `Job ${job.jobNumber}`,
      minutes: minutesLate,
      forCleaners: wording.line("for-cleaners", "INBOX", { cleanerNames }, Boolean(cleanerNames)),
    });
    const body = alert.body;
    const email = wording.render("safety-overdue", "EMAIL", { messageText: body, jobNumber: job.jobNumber });

    await notifyAdminsByPush({
      subject: alert.title,
      body,
      jobId: job.id,
    });

    await notifyAdminsByEmail({
      subject: email.subject,
      html: email.html,
    });

    alerted += 1;
  }

  return {
    scanned: overdueJobs.length,
    alerted,
  };
}
