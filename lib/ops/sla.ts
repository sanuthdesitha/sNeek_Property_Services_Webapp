import { JobStatus, NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { fromZonedTime } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import type { CaseSeverityLevel } from "@/lib/settings";
import {
  autoResolveJobCases,
  findOpenAutoCase,
  meetsAutoOpenThreshold,
  overdueCaseThresholdMinutes,
} from "@/lib/cases/auto-case";

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.UNASSIGNED,
  JobStatus.OFFERED,
  JobStatus.ASSIGNED,
  JobStatus.IN_PROGRESS,
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
];

const SLA_CASE_TITLE_PREFIX = "SLA breach";

/**
 * Map "how overdue" to a case severity so the auto-open threshold (in settings)
 * can keep minor overruns out of the formal case queue. A job a little overdue
 * is MEDIUM (soft attention only at the default HIGH threshold); a job hours
 * overdue is HIGH/CRITICAL and earns a real case.
 */
function severityForOverdue(minsOverdue: number, escalationMinutes: number): CaseSeverityLevel {
  const ratio = escalationMinutes > 0 ? minsOverdue / escalationMinutes : minsOverdue;
  if (ratio >= 8 || minsOverdue >= 240) return "CRITICAL";
  if (ratio >= 3 || minsOverdue >= 120) return "HIGH";
  if (ratio >= 1.5) return "MEDIUM";
  return "LOW";
}

const SLA_TZ = "Australia/Sydney";

function parseDueDateTime(scheduledDate: Date, dueTime: string | null | undefined) {
  if (!dueTime || !/^\d{2}:\d{2}$/.test(dueTime)) return null;
  const [h, m] = dueTime.split(":").map((value) => Number(value));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  // `dueTime` ("HH:MM") is a Sydney wall-clock time; `scheduledDate` is stored
  // as UTC-midnight of the Sydney calendar date. Build the due instant in the
  // Sydney zone — using Date.UTC treated "09:00" as 09:00 UTC (= 19:00-20:00
  // Sydney), so every SLA warning/escalation fired ~10-11h late.
  const y = scheduledDate.getUTCFullYear();
  const mo = String(scheduledDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(scheduledDate.getUTCDate()).padStart(2, "0");
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return fromZonedTime(`${y}-${mo}-${d}T${hh}:${mm}:00`, SLA_TZ);
}

export async function runSlaEscalation(now = new Date()) {
  const settings = await getAppSettings();
  if (!settings.sla.enabled) {
    return { warned: 0, escalated: 0, skipped: 0, healed: 0, reasons: ["SLA is disabled in settings."] };
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
      // CASE GATING: a case is only opened once the overdue passes the SLA
      // window + grace AND the derived severity reaches the configured
      // threshold. Smaller breaches stay as soft attention items (the admin
      // immediate-attention panel already surfaces overdue jobs) — no case.
      const severity = severityForOverdue(minsOverdue, settings.sla.overdueEscalationMinutes);
      const caseThreshold = overdueCaseThresholdMinutes(
        settings.sla.overdueEscalationMinutes,
        settings.caseAutomation
      );
      const shouldOpenCase =
        settings.sla.createIssueOnOverdue &&
        minsOverdue >= caseThreshold &&
        meetsAutoOpenThreshold(severity, settings.caseAutomation);

      if (shouldOpenCase) {
        // DEDUPE: reuse the in-memory check first, then confirm against the DB
        // (covers cases created outside this batch / by other call sites).
        const alreadyOpen =
          existingSlaIssue ||
          (settings.caseAutomation.dedupeByJobAndType
            ? await findOpenAutoCase({ jobId: job.id, titlePrefix: SLA_CASE_TITLE_PREFIX })
            : null);
        if (!alreadyOpen) {
          await db.issueTicket.create({
            data: {
              jobId: job.id,
              title: SLA_CASE_TITLE_PREFIX,
              description: `Job overdue by ${minsOverdue} minutes. Due ${job.dueTime}.`,
              severity,
              status: "OPEN",
              state: "OPEN",
              caseType: "SLA",
              source: "SLA_AUTOMATION",
              slaBreachAt: dueAt,
            },
          });
        }
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

  // SELF-HEAL: any open SLA auto-case whose job is no longer active (completed,
  // invoiced, or cancelled) should auto-resolve with a transition note instead
  // of lingering in the queue. Honours the autoResolveOnClear setting.
  let healed = 0;
  if (settings.caseAutomation.autoResolveOnClear) {
    const staleSlaCases = await db.issueTicket.findMany({
      where: {
        source: "SLA_AUTOMATION",
        status: { notIn: ["RESOLVED", "CLOSED"] },
        job: { status: { notIn: ACTIVE_JOB_STATUSES } },
      },
      select: { jobId: true, job: { select: { status: true } } },
      take: 500,
    });
    const seenJobIds = new Set<string>();
    for (const row of staleSlaCases) {
      if (!row.jobId || seenJobIds.has(row.jobId)) continue;
      seenJobIds.add(row.jobId);
      healed += await autoResolveJobCases({
        jobId: row.jobId,
        titlePrefix: SLA_CASE_TITLE_PREFIX,
        reason: `Underlying job is no longer active (status ${row.job?.status ?? "unknown"}); SLA breach condition cleared.`,
        actorId: systemActorId,
      });
    }
  }

  return { warned, escalated, skipped, healed, reasons: [] as string[] };
}
