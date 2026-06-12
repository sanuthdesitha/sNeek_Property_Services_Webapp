/**
 * Fallback hourly rate used when a cleaner has no pay rate configured anywhere
 * (no per-assignment payRate, no user hourlyRate, no per-job-type setting).
 *
 * This is the SAME value used by both the payroll run computation
 * (lib/finance/payroll.ts) and the cleaner's own invoice (lib/cleaner/invoice.ts)
 * so the two never disagree. When this fallback is used, the computed row carries
 * `rateMissing: true` so the missing-rate condition can be surfaced and fixed.
 */
export const DEFAULT_CLEANER_HOURLY_RATE = 40;
