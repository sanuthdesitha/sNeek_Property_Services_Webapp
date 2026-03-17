import { db } from "@/lib/db";

export interface JobTimelineEvent {
  id: string;
  at: string;
  type:
    | "JOB"
    | "ASSIGNMENT"
    | "TIMELOG"
    | "FORM_SUBMISSION"
    | "QA"
    | "ISSUE"
    | "NOTIFICATION"
    | "LAUNDRY"
    | "REPORT"
    | "AUDIT";
  title: string;
  detail: string;
  actorName: string | null;
}

function eventId(prefix: string, id: string) {
  return `${prefix}:${id}`;
}

export async function buildJobTimeline(jobId: string): Promise<JobTimelineEvent[]> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      status: true,
      jobType: true,
      scheduledDate: true,
      startTime: true,
      dueTime: true,
      endTime: true,
      property: { select: { name: true } },
    },
  });
  if (!job) throw new Error("Job not found.");

  const [assignments, timelogs, submissions, qaReviews, issues, notifications, laundryTask, report, audits] =
    await Promise.all([
      db.jobAssignment.findMany({
        where: { jobId },
        select: {
          id: true,
          assignedAt: true,
          removedAt: true,
          isPrimary: true,
          payRate: true,
          user: { select: { name: true, email: true } },
        },
      }),
      db.timeLog.findMany({
        where: { jobId },
        select: {
          id: true,
          startedAt: true,
          stoppedAt: true,
          durationM: true,
          notes: true,
          user: { select: { name: true, email: true } },
        },
      }),
      db.formSubmission.findMany({
        where: { jobId },
        include: {
          submittedBy: { select: { name: true, email: true } },
          media: { select: { id: true } },
        },
      }),
      db.qAReview.findMany({
        where: { jobId },
        select: { id: true, createdAt: true, score: true, passed: true, notes: true, reviewedById: true },
      }),
      db.issueTicket.findMany({
        where: { jobId },
        select: { id: true, createdAt: true, updatedAt: true, title: true, status: true, severity: true },
      }),
      db.notification.findMany({
        where: { jobId },
        select: { id: true, createdAt: true, sentAt: true, channel: true, status: true, subject: true, body: true },
      }),
      db.laundryTask.findUnique({
        where: { jobId },
        include: {
          confirmations: {
            select: {
              id: true,
              createdAt: true,
              laundryReady: true,
              bagLocation: true,
              notes: true,
              confirmedById: true,
            },
          },
        },
      }),
      db.report.findUnique({
        where: { jobId },
        select: { id: true, createdAt: true, updatedAt: true, sentAt: true, sentToClient: true },
      }),
      db.auditLog.findMany({
        where: { jobId },
        select: { id: true, createdAt: true, action: true, entity: true, user: { select: { name: true, email: true } } },
      }),
    ]);

  const userIds = Array.from(
    new Set([
      ...qaReviews.map((row) => row.reviewedById).filter(Boolean),
      ...(laundryTask?.confirmations.map((row) => row.confirmedById) ?? []),
    ])
  ) as string[];

  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : [];
  const userById = new Map(users.map((user) => [user.id, user]));

  const events: JobTimelineEvent[] = [];

  events.push({
    id: eventId("job", job.id),
    at: job.createdAt.toISOString(),
    type: "JOB",
    title: "Job created",
    detail: `${job.property.name} - ${job.jobType.replace(/_/g, " ")} (${job.status.replace(/_/g, " ")})`,
    actorName: null,
  });

  events.push({
    id: eventId("job-updated", job.id),
    at: job.updatedAt.toISOString(),
    type: "JOB",
    title: "Job last updated",
    detail: `Scheduled ${job.scheduledDate.toISOString().slice(0, 10)} ${job.startTime ?? ""} -> ${job.dueTime ?? ""}`,
    actorName: null,
  });

  for (const assignment of assignments) {
    const actorName = assignment.user.name ?? assignment.user.email ?? null;
    events.push({
      id: eventId("assign", assignment.id),
      at: assignment.assignedAt.toISOString(),
      type: "ASSIGNMENT",
      title: assignment.isPrimary ? "Primary cleaner assigned" : "Cleaner assigned",
      detail: `Rate ${assignment.payRate ?? "n/a"}${assignment.removedAt ? " (removed later)" : ""}`,
      actorName,
    });
    if (assignment.removedAt) {
      events.push({
        id: eventId("assign-removed", assignment.id),
        at: assignment.removedAt.toISOString(),
        type: "ASSIGNMENT",
        title: "Cleaner removed",
        detail: "Assignment marked removed.",
        actorName,
      });
    }
  }

  for (const log of timelogs) {
    const actorName = log.user.name ?? log.user.email ?? null;
    events.push({
      id: eventId("time-start", log.id),
      at: log.startedAt.toISOString(),
      type: "TIMELOG",
      title: "Cleaner started timer",
      detail: log.notes?.trim() ? log.notes.trim().slice(0, 220) : "Time log started.",
      actorName,
    });
    if (log.stoppedAt) {
      events.push({
        id: eventId("time-stop", log.id),
        at: log.stoppedAt.toISOString(),
        type: "TIMELOG",
        title: "Cleaner stopped timer",
        detail: `${Math.max(0, Number(log.durationM ?? 0))} minutes recorded.`,
        actorName,
      });
    }
  }

  for (const submission of submissions) {
    const actorName = submission.submittedBy.name ?? submission.submittedBy.email ?? null;
    events.push({
      id: eventId("submission", submission.id),
      at: submission.createdAt.toISOString(),
      type: "FORM_SUBMISSION",
      title: "Form submitted",
      detail: `Template ${submission.templateId}, media ${submission.media.length}, laundry ${submission.laundryReady ? "ready" : "not ready"}.`,
      actorName,
    });
  }

  for (const review of qaReviews) {
    const reviewer = review.reviewedById ? userById.get(review.reviewedById) : null;
    events.push({
      id: eventId("qa", review.id),
      at: review.createdAt.toISOString(),
      type: "QA",
      title: review.passed ? "QA passed" : "QA failed",
      detail: `Score ${review.score}${review.notes ? ` - ${review.notes.slice(0, 200)}` : ""}`,
      actorName: reviewer?.name ?? reviewer?.email ?? null,
    });
  }

  for (const issue of issues) {
    events.push({
      id: eventId("issue", issue.id),
      at: issue.createdAt.toISOString(),
      type: "ISSUE",
      title: `${issue.severity} issue opened`,
      detail: `${issue.title} (${issue.status})`,
      actorName: null,
    });
    if (issue.updatedAt.getTime() !== issue.createdAt.getTime()) {
      events.push({
        id: eventId("issue-updated", issue.id),
        at: issue.updatedAt.toISOString(),
        type: "ISSUE",
        title: "Issue updated",
        detail: `${issue.title} (${issue.status})`,
        actorName: null,
      });
    }
  }

  for (const notification of notifications) {
    events.push({
      id: eventId("notif", notification.id),
      at: (notification.sentAt ?? notification.createdAt).toISOString(),
      type: "NOTIFICATION",
      title: `Notification ${notification.status.toLowerCase()}`,
      detail: `${notification.channel}${notification.subject ? ` - ${notification.subject}` : ""}`,
      actorName: null,
    });
  }

  if (laundryTask) {
    events.push({
      id: eventId("laundry", laundryTask.id),
      at: laundryTask.createdAt.toISOString(),
      type: "LAUNDRY",
      title: "Laundry task created",
      detail: `${laundryTask.status} (${laundryTask.pickupDate.toISOString().slice(0, 10)} -> ${laundryTask.dropoffDate.toISOString().slice(0, 10)})`,
      actorName: null,
    });
    for (const confirmation of laundryTask.confirmations) {
      const actor = userById.get(confirmation.confirmedById);
      events.push({
        id: eventId("laundry-confirm", confirmation.id),
        at: confirmation.createdAt.toISOString(),
        type: "LAUNDRY",
        title: confirmation.laundryReady ? "Laundry marked ready" : "Laundry marked not ready",
        detail: `${confirmation.bagLocation ?? "No bag location"}${confirmation.notes ? ` - ${confirmation.notes}` : ""}`,
        actorName: actor?.name ?? actor?.email ?? null,
      });
    }
  }

  if (report) {
    events.push({
      id: eventId("report", report.id),
      at: report.createdAt.toISOString(),
      type: "REPORT",
      title: "Job report generated",
      detail: report.sentToClient ? "Report sent to client." : "Report stored.",
      actorName: null,
    });
    if (report.sentAt) {
      events.push({
        id: eventId("report-sent", report.id),
        at: report.sentAt.toISOString(),
        type: "REPORT",
        title: "Report sent",
        detail: "Client notification sent.",
        actorName: null,
      });
    }
  }

  for (const audit of audits) {
    events.push({
      id: eventId("audit", audit.id),
      at: audit.createdAt.toISOString(),
      type: "AUDIT",
      title: audit.action,
      detail: `${audit.entity} change`,
      actorName: audit.user.name ?? audit.user.email ?? null,
    });
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}
