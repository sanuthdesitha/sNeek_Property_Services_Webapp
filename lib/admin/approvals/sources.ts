/**
 * CleanerPayAdjustment.source values that have their own Approvals queues.
 * Pay requests are every other source (including null / legacy rows).
 * Plain module shared by GET /api/admin/all-approvals and the bulk route.
 */
export const RECTIFICATION_SOURCES: readonly string[] = ["QA_RECTIFICATION_PAY", "RECTIFICATION_DEDUCTION", "REWORK_DEDUCTION"];
export const BONUS_SOURCES: readonly string[] = ["STREAK_5", "STREAK_10", "MONTHLY_RANK_1", "MONTHLY_RANK_2"];
export const ACCOUNTABILITY_SOURCES: readonly string[] = [...RECTIFICATION_SOURCES, ...BONUS_SOURCES];
