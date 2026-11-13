/**
 * Voided laundry runs (2026-11-14) are left out of every list, count, alert,
 * nudge, statistic and total. They are stored as SKIPPED_PICKUP, so queries
 * that already leave skipped runs out need nothing more; the queries that
 * can include skipped runs spread this filter. PLAIN module (no Prisma client).
 *
 * The only places a voided run is shown are the run page and the office's
 * Completed history under the "Voided" filter.
 */
export const NOT_VOIDED = { voidedAt: null } as const;
export const ONLY_VOIDED = { voidedAt: { not: null } } as const;
