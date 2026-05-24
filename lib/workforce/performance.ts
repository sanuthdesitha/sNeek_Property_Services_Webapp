import { db } from "@/lib/db";

/**
 * Wrap a Prisma promise so a failure logs (instead of silently producing `null`
 * metrics) and returns the fallback. Critical for diagnosing schema-mismatch
 * bugs — previously all queries swallowed errors and the UI rendered "—" with
 * no signal that anything was wrong.
 */
function safeQuery<T>(label: string, p: Promise<T>, fallback: T): Promise<T> {
  return p.catch((err) => {
    console.warn(`[performance:${label}] query failed`, err instanceof Error ? err.message : err);
    return fallback;
  });
}

/**
 * Cleaner Performance Metrics
 *
 * 11 industry-standard field-services KPIs (Jobber / Housecall Pro / ServiceTitan / ServiceM8).
 * All metrics are window-scoped (30 / 90 / 365 day rolling windows).
 *
 * The aggregator is intentionally defensive — each metric query is wrapped in `.catch(() => [])`
 * so the dashboard renders even if a schema model is missing or a relation is broken.
 * Missing data yields `null` (rendered as "—" in the UI), never throws.
 */
export interface PerformanceMetrics {
  userId: string;
  windowDays: number;
  windowStart: Date;
  quality: { score: number | null; sampleSize: number };
  reliability: { onTimePercent: number | null; sampleSize: number };
  punctuality: { avgMinutesLate: number | null; sampleSize: number };
  attendance: {
    completedJobs: number;
    assignedJobs: number;
    percent: number | null;
  };
  documentation: {
    fullyDocumentedPercent: number | null;
    sampleSize: number;
  };
  customerSatisfaction: { avgRating: number | null; sampleSize: number };
  responseRate: { acceptedPercent: number | null; sampleSize: number };
  disputeRate: {
    disputes: number;
    totalJobs: number;
    percent: number | null;
  };
  noShowRate: { noShows: number; scheduled: number; percent: number | null };
  documentCompliance: {
    current: number;
    expired: number;
    percent: number | null;
  };
  trainingCompletion: {
    completed: number;
    assigned: number;
    percent: number | null;
  };
}

/**
 * Build a JS Date from Job.scheduledDate (UTC midnight) + Job.startTime ("HH:mm" local).
 * Returns null if either is missing. We treat the time as the property's local time but
 * since Job.scheduledDate is already UTC midnight of the scheduled day, we add the HH:mm
 * offset to get a reasonable approximation for "scheduled start". For punctuality / on-time
 * comparisons this is consistent — both sides of the comparison share the same convention.
 */
function combineScheduledStart(
  scheduledDate: Date | null | undefined,
  startTime: string | null | undefined,
): Date | null {
  if (!scheduledDate) return null;
  if (!startTime) return scheduledDate;
  const match = /^(\d{1,2}):(\d{2})/.exec(startTime);
  if (!match) return scheduledDate;
  const hours = parseInt(match[1], 10);
  const mins = parseInt(match[2], 10);
  const out = new Date(scheduledDate);
  out.setUTCHours(hours, mins, 0, 0);
  return out;
}

export async function getPerformanceMetrics(
  userId: string,
  windowDays = 30,
): Promise<PerformanceMetrics> {
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [
    qaSubmissions,
    assignmentRows,
    timeLogs,
    submissionRows,
    feedbackRows,
    satisfactionRows,
    documentRows,
    learningRows,
  ] = await Promise.all([
    safeQuery(
      "qaFormSubmission",
      db.qaFormSubmission.findMany({
        where: {
          createdAt: { gte: windowStart },
          job: { assignments: { some: { userId } } },
        },
        select: { score: true },
      }),
      [] as Array<{ score: number | null }>,
    ),

    safeQuery(
      "jobAssignment",
      db.jobAssignment.findMany({
        where: {
          userId,
          assignedAt: { gte: windowStart },
        },
        select: {
          assignedAt: true,
          offeredAt: true,
          respondedAt: true,
          responseStatus: true,
          job: {
            select: {
              id: true,
              status: true,
              scheduledDate: true,
              startTime: true,
              arrivedAt: true,
              // Job has no `completedAt` column — we use the `updatedAt` of a
              // job with status COMPLETED as the completion timestamp proxy.
              updatedAt: true,
            },
          },
        },
      }),
      [] as any[],
    ),

    safeQuery(
      "timeLog",
      db.timeLog.findMany({
        where: { userId, startedAt: { gte: windowStart } },
        select: {
          startedAt: true,
          job: {
            select: { scheduledDate: true, startTime: true },
          },
        },
      }),
      [] as any[],
    ),

    safeQuery(
      "formSubmission",
      db.formSubmission.findMany({
        where: {
          submittedById: userId,
          createdAt: { gte: windowStart },
        },
        select: {
          id: true,
          autoQaScore: true,
          media: { select: { id: true } },
        },
      }),
      [] as any[],
    ),

    safeQuery(
      "jobFeedback",
      db.jobFeedback.findMany({
        where: {
          submittedAt: { gte: windowStart, not: null },
          job: { assignments: { some: { userId } } },
        },
        select: { rating: true },
      }),
      [] as Array<{ rating: number | null }>,
    ),

    safeQuery(
      "clientSatisfactionRating",
      db.clientSatisfactionRating.findMany({
        where: {
          createdAt: { gte: windowStart },
          job: { assignments: { some: { userId } } },
        },
        select: { score: true },
      }),
      [] as Array<{ score: number | null }>,
    ),

    safeQuery(
      "staffDocument",
      db.staffDocument.findMany({
        where: { userId },
        select: { expiresAt: true, status: true },
      }),
      [] as any[],
    ),

    safeQuery(
      "learningAssignment",
      db.learningAssignment.findMany({
        where: { userId },
        select: { completedAt: true, createdAt: true, status: true },
      }),
      [] as any[],
    ),
  ]);

  // 1. Quality score — average QA submission score for jobs cleaner was assigned to
  const qaScores = qaSubmissions
    .map((q) => q.score)
    .filter((s): s is number => typeof s === "number");
  const qualityAvg =
    qaScores.length > 0
      ? qaScores.reduce((a, b) => a + b, 0) / qaScores.length
      : null;

  // 2. Reliability — arrived within 15 min of scheduled start
  const arrivalRows = assignmentRows.filter((a: any) => {
    const sched = combineScheduledStart(a.job?.scheduledDate, a.job?.startTime);
    return a.job?.arrivedAt && sched;
  });
  const onTimeCount = arrivalRows.filter((a: any) => {
    const sched = combineScheduledStart(a.job.scheduledDate, a.job.startTime)!;
    const delta = (a.job.arrivedAt.getTime() - sched.getTime()) / 60000;
    return delta <= 15;
  }).length;
  const reliabilityPct =
    arrivalRows.length > 0
      ? Math.round((onTimeCount / arrivalRows.length) * 100)
      : null;

  // 3. Punctuality — average minutes from scheduled start to actual clock-in
  const punctualityDeltas = timeLogs
    .map((t: any) => {
      const sched = combineScheduledStart(
        t.job?.scheduledDate,
        t.job?.startTime,
      );
      if (!sched || !t.startedAt) return null;
      return (t.startedAt.getTime() - sched.getTime()) / 60000;
    })
    .filter((d): d is number => typeof d === "number");
  const avgMinutesLate =
    punctualityDeltas.length > 0
      ? Math.round(
          punctualityDeltas.reduce((a, b) => a + b, 0) /
            punctualityDeltas.length,
        )
      : null;

  // 4. Attendance — completed / assigned in window
  const completedJobs = assignmentRows.filter(
    (a: any) => a.job?.status === "COMPLETED",
  ).length;
  const assignedJobs = assignmentRows.length;
  const attendancePct =
    assignedJobs > 0 ? Math.round((completedJobs / assignedJobs) * 100) : null;

  // 5. Documentation completeness — % of submissions with >=1 media attachment
  const documentedSubmissions = submissionRows.filter(
    (s: any) => Array.isArray(s.media) && s.media.length > 0,
  ).length;
  const documentationPct =
    submissionRows.length > 0
      ? Math.round((documentedSubmissions / submissionRows.length) * 100)
      : null;

  // 6. Customer satisfaction — JobFeedback.rating (1-5) and ClientSatisfactionRating.score
  //    Both treated as 1-5; merge into a single average.
  const feedbackRatings = feedbackRows
    .map((f) => f.rating)
    .filter((r): r is number => typeof r === "number");
  const satisfactionScores = satisfactionRows
    .map((s) => s.score)
    .filter((s): s is number => typeof s === "number");
  const allRatings = [...feedbackRatings, ...satisfactionScores];
  const avgRating =
    allRatings.length > 0
      ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length
      : null;

  // 7. Response rate — % of assignment offers accepted within 1 hour
  const respondableAssignments = assignmentRows.filter(
    (a: any) => a.offeredAt && a.respondedAt,
  );
  const acceptedWithinHour = respondableAssignments.filter((a: any) => {
    if (a.responseStatus !== "ACCEPTED") return false;
    const delta = (a.respondedAt.getTime() - a.offeredAt.getTime()) / 60000;
    return delta <= 60;
  }).length;
  const responsePct =
    respondableAssignments.length > 0
      ? Math.round(
          (acceptedWithinHour / respondableAssignments.length) * 100,
        )
      : null;

  // 8. Dispute rate — IssueTicket related to jobs the cleaner was assigned to.
  //    Defensive: if model/relation isn't queryable cleanly, fall back to 0.
  let disputeCount = 0;
  try {
    disputeCount = await db.issueTicket.count({
      where: {
        createdAt: { gte: windowStart },
        job: { assignments: { some: { userId } } },
      } as any,
    });
  } catch {
    disputeCount = 0;
  }
  const disputePct =
    assignedJobs > 0
      ? Math.round((disputeCount / assignedJobs) * 100 * 10) / 10
      : null;

  // 9. No-show rate — assignments with status DECLINED or job CANCELLED for no-show.
  //    Conservative: count assignments where responseStatus === "DECLINED" after the scheduled date.
  const noShows = assignmentRows.filter((a: any) => {
    if (a.responseStatus !== "DECLINED") return false;
    const sched = combineScheduledStart(a.job?.scheduledDate, a.job?.startTime);
    if (!sched) return false;
    return sched < new Date();
  }).length;
  const noShowPct =
    assignedJobs > 0
      ? Math.round((noShows / assignedJobs) * 100 * 10) / 10
      : null;

  // 10. Document compliance — % of staff documents that are still current (expiresAt null or > now)
  const now = new Date();
  const currentDocs = documentRows.filter(
    (d: any) => !d.expiresAt || d.expiresAt > now,
  ).length;
  const expiredDocs = documentRows.length - currentDocs;
  const docCompliancePct =
    documentRows.length > 0
      ? Math.round((currentDocs / documentRows.length) * 100)
      : null;

  // 11. Training completion — % of learning assignments completed
  const completedLearning = learningRows.filter(
    (l: any) => l.completedAt || l.status === "COMPLETED",
  ).length;
  const trainingPct =
    learningRows.length > 0
      ? Math.round((completedLearning / learningRows.length) * 100)
      : null;

  return {
    userId,
    windowDays,
    windowStart,
    quality: { score: qualityAvg, sampleSize: qaScores.length },
    reliability: {
      onTimePercent: reliabilityPct,
      sampleSize: arrivalRows.length,
    },
    punctuality: { avgMinutesLate, sampleSize: punctualityDeltas.length },
    attendance: {
      completedJobs,
      assignedJobs,
      percent: attendancePct,
    },
    documentation: {
      fullyDocumentedPercent: documentationPct,
      sampleSize: submissionRows.length,
    },
    customerSatisfaction: {
      avgRating,
      sampleSize: allRatings.length,
    },
    responseRate: {
      acceptedPercent: responsePct,
      sampleSize: respondableAssignments.length,
    },
    disputeRate: {
      disputes: disputeCount,
      totalJobs: assignedJobs,
      percent: disputePct,
    },
    noShowRate: {
      noShows,
      scheduled: assignedJobs,
      percent: noShowPct,
    },
    documentCompliance: {
      current: currentDocs,
      expired: expiredDocs,
      percent: docCompliancePct,
    },
    trainingCompletion: {
      completed: completedLearning,
      assigned: learningRows.length,
      percent: trainingPct,
    },
  };
}

/**
 * Convenience helper: fetch metrics for multiple cleaners over a single window in parallel.
 */
export async function getPerformanceMetricsForUsers(
  userIds: string[],
  windowDays = 30,
): Promise<PerformanceMetrics[]> {
  return Promise.all(userIds.map((id) => getPerformanceMetrics(id, windowDays)));
}
