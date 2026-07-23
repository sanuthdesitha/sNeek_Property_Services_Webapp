/**
 * One QA outcome per job.
 *
 * Historical double-submits (an inspector pressing Submit twice, an admin
 * pressing Save twice) left some jobs with several QAReview rows. New writes
 * are now guarded server-side, but the old duplicates still exist — and any
 * feed that lists reviews raw shows the cleaner two verdicts for one clean.
 *
 * The pick mirrors lib/qa/authority.ts: a real on-site inspection (kind "QA")
 * outranks an admin quick score (kind "ADMIN"); within the same kind the
 * newest row wins (a re-review supersedes the original).
 */

type ReviewLike = {
  jobId: string;
  kind: string | null;
  createdAt: Date | string;
};

const KIND_RANK: Record<string, number> = { QA: 2, ADMIN: 1 };

function rank(kind: string | null): number {
  return KIND_RANK[String(kind)] ?? 0;
}

function time(value: Date | string): number {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Returns at most one review per jobId, keeping the input's relative order of
 * the surviving rows.
 */
export function pickAuthoritativeReviews<T extends ReviewLike>(reviews: T[]): T[] {
  const bestByJob = new Map<string, T>();
  for (const review of reviews) {
    const current = bestByJob.get(review.jobId);
    if (
      !current ||
      rank(review.kind) > rank(current.kind) ||
      (rank(review.kind) === rank(current.kind) && time(review.createdAt) > time(current.createdAt))
    ) {
      bestByJob.set(review.jobId, review);
    }
  }
  return reviews.filter((r) => bestByJob.get(r.jobId) === r);
}
