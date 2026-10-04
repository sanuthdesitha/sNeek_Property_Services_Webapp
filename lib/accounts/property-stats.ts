import { db } from "@/lib/db";
import { summarizeCompletedHistory, completedServiceDate } from "./completed-history";

export interface PropertyStats {
  propertyId: string;
  totalJobs: number;
  jobsLast30d: number;
  jobsLast90d: number;
  jobsLast365d: number;
  lastJobAt: Date | null;
  lifetimeValue: number;
  averageJobRating: number | null;
  ratingSampleSize: number;
  recentMediaUrls: string[]; // last 6 photo URLs
  cleanersWhoServiced: number; // distinct cleaner count
}

export async function getPropertyStats(propertyId: string): Promise<PropertyStats> {
  const jobs = await db.job
    .findMany({
      where: { propertyId },
      select: {
        id: true,
        scheduledDate: true,
        status: true,
        completedAt: true,
        assignments: { select: { userId: true } },
      },
    })
    .catch(() => [] as any[]);

  const jobIds = jobs.map((j: any) => j.id);

  const [invoiceLines, feedback, satisfaction, recentMedia] = await Promise.all([
    jobIds.length > 0
      ? db.clientInvoiceLine
          .findMany({
            where: { jobId: { in: jobIds }, invoice: { status: "PAID" } },
            select: { lineTotal: true },
          })
          .catch(() => [] as any[])
      : Promise.resolve([] as any[]),
    db.jobFeedback
      .findMany({
        where: { job: { propertyId } },
        select: { rating: true },
      })
      .catch(() => [] as any[]),
    db.clientSatisfactionRating
      .findMany({
        where: { job: { propertyId } },
        select: { score: true },
      })
      .catch(() => [] as any[]),
    jobIds.length > 0
      ? db.submissionMedia
          .findMany({
            where: {
              mediaType: "PHOTO" as any,
              submission: { jobId: { in: jobIds } },
            },
            select: { url: true, createdAt: true, submission: { select: { jobId: true } } },
            orderBy: { createdAt: "desc" },
            take: 6,
          })
          .catch(() => [] as any[])
      : Promise.resolve([] as any[]),
  ]);

  const now = new Date();
  const { lastJobAt, jobsLast30d, jobsLast90d, jobsLast365d } = summarizeCompletedHistory(jobs, now);

  const lifetimeValue = (invoiceLines as any[]).reduce(
    (sum, line) => sum + Number(line.lineTotal || 0),
    0
  );

  const ratingsRaw = [
    ...feedback.map((f: any) => (typeof f.rating === "number" ? f.rating : null)),
    ...satisfaction.map((s: any) => (typeof s.score === "number" ? s.score : null)),
  ];
  const ratings = ratingsRaw.filter((r): r is number => r !== null);
  const averageJobRating =
    ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  const mediaUrls = (recentMedia as any[]).map((m) => m.url).filter(Boolean);

  const cleanerIds = new Set<string>();
  for (const job of jobs as any[]) {
    if (!completedServiceDate(job, now)) continue;
    for (const a of job.assignments ?? []) {
      if (a?.userId) cleanerIds.add(a.userId);
    }
  }

  return {
    propertyId,
    totalJobs: jobs.length,
    jobsLast30d,
    jobsLast90d,
    jobsLast365d,
    lastJobAt,
    lifetimeValue,
    averageJobRating,
    ratingSampleSize: ratings.length,
    recentMediaUrls: mediaUrls,
    cleanersWhoServiced: cleanerIds.size,
  };
}
