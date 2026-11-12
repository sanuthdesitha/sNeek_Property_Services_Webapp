/**
 * Streak and last-5 / last-10 averages for many cleaners at once.
 *
 * The accountability overview used to call getPerformanceMetrics once per
 * cleaner, which runs about a dozen queries each, only to read these three
 * numbers. Here each cleaner costs ONE query (their latest completed+reviewed
 * jobs; "latest N per cleaner" cannot be expressed as one Prisma query without
 * raw SQL), the settings are read once, and the arithmetic is the exact
 * function getPerformanceMetrics uses (summariseAccountabilityStreak).
 *
 * A failed read leaves that cleaner's streak unknown (null) rather than zero.
 */
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import {
  ACCOUNTABILITY_STREAK_JOB_SELECT,
  ACCOUNTABILITY_STREAK_LOOKBACK,
  summariseAccountabilityStreak,
  type AccountabilityStreakJob,
} from "@/lib/workforce/performance";

export type CleanerStreak = {
  currentStreak: number;
  last5Avg: number | null;
  last10Avg: number | null;
  /** Completed, reviewed jobs the figures were read from (0 = no data). */
  sample: number;
};

export async function loadCleanerStreaks(cleanerIds: readonly string[]): Promise<Map<string, CleanerStreak | null>> {
  const out = new Map<string, CleanerStreak | null>();
  if (cleanerIds.length === 0) return out;
  const minScore = await getAppSettings()
    .then((settings) => settings.accountability.bonuses.streakMinScore)
    .catch(() => 97);
  const results = await Promise.all(
    cleanerIds.map((userId) =>
      db.job
        .findMany({
          where: {
            status: JobStatus.COMPLETED,
            assignments: { some: { userId } },
            qaReviews: { some: {} },
          },
          orderBy: { completedAt: "desc" },
          take: ACCOUNTABILITY_STREAK_LOOKBACK,
          select: ACCOUNTABILITY_STREAK_JOB_SELECT,
        })
        .then((jobs) => jobs as AccountabilityStreakJob[])
        .catch(() => null),
    ),
  );
  cleanerIds.forEach((id, index) => {
    const jobs = results[index];
    if (!jobs) {
      out.set(id, null);
      return;
    }
    out.set(id, { ...summariseAccountabilityStreak(jobs, minScore), sample: jobs.length });
  });
  return out;
}
