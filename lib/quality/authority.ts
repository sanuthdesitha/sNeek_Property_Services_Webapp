/**
 * Authoritative review for one job, as every accountability reader defines
 * it: highest kind priority (QA > ADMIN > AUTO), then the most recent. Same
 * rule as lib/accountability/streaks.ts and lib/workforce/performance.ts.
 */
export const REVIEW_KIND_PRIORITY: Record<string, number> = { QA: 3, ADMIN: 2, AUTO: 1 };

export type ReviewLike = { kind: string; createdAt: Date };

export function pickAuthoritativeReview<T extends ReviewLike>(reviews: readonly T[]): T | null {
  if (reviews.length === 0) return null;
  return reviews.reduce((best, current) => {
    const bestPriority = REVIEW_KIND_PRIORITY[best.kind] ?? 1;
    const currentPriority = REVIEW_KIND_PRIORITY[current.kind] ?? 1;
    if (currentPriority > bestPriority) return current;
    if (currentPriority === bestPriority && current.createdAt > best.createdAt) return current;
    return best;
  });
}
