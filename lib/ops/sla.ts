import { JobStatus, NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.ASSIGNED,
  JobStatus.IN_PROGRESS,
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
];

function parseDueDateTime(scheduledDate: Date, dueTime: string | null | undefined) {
  if (!dueTime || !/^\d{2}:\d{2}$/.test(dueTime)) return null;
  const [h, m] = dueTime.split(":").map((value) => Number(value));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return new Date(
    Date.UTC(
      scheduledDate.getUTCFullYear(),
      scheduledDate.getUTCMonth(),
      scheduledDate.getUTCDate(),
      h,
      m,
      0,
      0
    )
  );
}

export async function runSlaEscalation(now = new Date()) {
  const settings = await getAppSettings();
  if (!settings.sla.enabled) {
    return { warned: 0, escalated: 0, skipped: 0, reasons: ["SLA is disabled in settings."] };
  }

  const jobs = await db.job.findMany({
    where: {
      status: { in: ACTIVE_JOB_STATUSES },
      dueTime: { not: null },
      scheduledDate: { lte: now },
    },
    include: {
      property: { select: { name: true, suburb: true } },
      issueTickets: {
        where: { status: { not: "RESOLVED" } },
        select: { id: true, title: true, status: true },
      },
    },
    orderBy: { scheduledDate: "asc" },
    take: 500,
  });

  const adminUsers = await db.user.findMany({
    where: { role: Role.ADMIN, isActive: true },
    select: { id: true },
  });
  const systemActorId = adminUsers[0]?.id ?? null;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const jobIds = jobs.map((job) => job.id);
  const recentAudit = jobIds.length
    ? await db.auditLog.findMany({
        where: {
          jobId: { in: jobIds },
          action: { in: ["SLA_WARN", "SLA_ESCALATE"] },
          createdAt: { gte: dayStart },
        },
        select: { jobId: true, action: true },
      })
    : [];
  const warnedToday = new Set(recentAudit.filter((row) => row.action === "SLA_WARN").map((row) => row.jobId));
  const escalatedToday = new Set(
    recentAudit.filter((row) => row.action === "SLA_ESCALATE").map((row) => row.jobId)
  );

  let warned = 0;
  let escalated = 0;
  let skipped = 0;

  for (const job of jobs) {
    const dueAt = parseDueDateTime(job.scheduledDate, job.dueTime);
    if (!dueAt) {
      skipped += 1;
      continue;
    }
    const msToDue = dueAt.getTime() - now.getTime();
    const minsToDue = Math.round(msToDue / 60_000);
    const minsOverdue = Math.max(0, Math.round((now.getTime() - dueAt.getTime()) / 60_000));

    const existingSlaIssue = job.issueTickets.find((issue) =>
      issue.title.toLowerCase().startsWith("sla breach")
    );

    if (minsOverdue >= settings.sla.overdueEscalationMinutes) {
      if (!existingSlaIssue && settings.sla.createIssueOnOverdue) {
        await db.issueTicket.create({
          data: {
            jobId: job.id,
            title: "SLA breach",
            description: `Job overdue by ${minsOverdue} minutes. Due ${job.dueTime}.`,
            severity: "HIGH",
            status: "OPEN",
          },
        });
      }

      if (settings.sla.notifyAdminOnOverdue) {
        if (!escalatedToday.has(job.id)) {
          await db.notification.createMany({
            data: adminUsers.map((admin) => ({
              userId: admin.id,
              jobId: job.id,
              channel: NotificationChannel.PUSH,
              subject: "SLA breach",
              body: `${job.property.name} (${job.property.suburb}) overdue by ${minsOverdue} mins.`,
              status: NotificationStatus.SENT,
              sentAt: new Date(),
            })),
            skipDuplicates: true,
          });
        }
      }

      if (!escalatedToday.has(job.id)) {
        if (systemActorId) {
          await db.auditLog
            .create({
              data: {
                userId: systemActorId,
                jobId: job.id,
                action: "SLA_ESCALATE",
                entity: "Job",
                entityId: job.id,
                after: { minsOverdue, dueTime: job.dueTime } as any,
              },
            })
            .catch(() => undefined);
        }
        escalatedToday.add(job.id);
      }

      escalated += 1;
      continue;
    }

    if (minsToDue > 0 && minsToDue <= settings.sla.warnHoursBeforeDue * 60) {
      if (!warnedToday.has(job.id)) {
        if (systemActorId) {
          await db.auditLog
            .create({
              data: {
                userId: systemActorId,
                jobId: job.id,
                action: "SLA_WARN",
                entity: "Job",
                entityId: job.id,
                after: { minsToDue, dueTime: job.dueTime } as any,
              },
            })
            .catch(() => undefined);
        }
        warnedToday.add(job.id);
      }
      warned += 1;
    }
  }

  return { warned, escalated, skipped, reasons: [] as string[] };
}
