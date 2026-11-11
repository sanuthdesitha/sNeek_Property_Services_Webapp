/**
 * Rules for a quality bonus proposed by hand from the Quality hub's Cleaners
 * tab (owner decision, sixth set, Wave C). Pure: shared by the server service,
 * the API route and the dialog, so the bounds the dialog states are the bounds
 * the server enforces.
 *
 * A manual quality bonus is ONLY a proposal: a PENDING pay adjustment that
 * lands in the existing Approvals "Pay requests" queue and is paid only after
 * the existing approval (PATCH /api/admin/pay-adjustments/[id]). There is no
 * bonus "type" in the schema (PayAdjustmentType is HOURLY | FIXED), so it is a
 * FIXED positive adjustment exactly as the admin "add payment" route writes a
 * pending one, with `source` left null (a person proposed it, so the payee is
 * told the outcome as for any person-raised adjustment) and the provenance in
 * `sourceKey` ("quality-bonus:<cleanerId>:<idempotency key>").
 */
import { z } from "zod";
import { BONUS_SOURCES } from "./types";

/** Smallest manual quality bonus, in dollars. */
export const MANUAL_BONUS_MIN_AMOUNT = 5;
/**
 * Largest manual quality bonus, in dollars. A ceiling for a by-hand reward
 * (the largest automatic bonus by default is the $75 monthly first place);
 * larger payments stay on the general Pay adjustments screen.
 */
export const MANUAL_BONUS_MAX_AMOUNT = 200;
export const MANUAL_BONUS_REASON_MIN = 3;
export const MANUAL_BONUS_REASON_MAX = 1000;

export const MANUAL_BONUS_TITLE = "Quality bonus";
export const MANUAL_BONUS_SOURCE_KEY_PREFIX = "quality-bonus:";
/** Audit `after.origin` marker. */
export const MANUAL_BONUS_ORIGIN = "manual quality bonus";

export function manualBonusSourceKey(cleanerId: string, idempotencyKey: string): string {
  return `${MANUAL_BONUS_SOURCE_KEY_PREFIX}${cleanerId}:${idempotencyKey}`;
}

export function isManualBonusSourceKey(sourceKey: string | null | undefined): boolean {
  return typeof sourceKey === "string" && sourceKey.startsWith(MANUAL_BONUS_SOURCE_KEY_PREFIX);
}

/**
 * Prisma filter for every bonus still awaiting a decision for cleaners:
 * the nightly job's automatic proposals and manual quality bonuses.
 */
export function pendingBonusWhere(cleanerIds: readonly string[]) {
  return {
    cleanerId: { in: [...cleanerIds] },
    status: "PENDING" as const,
    OR: [
      { source: { in: [...BONUS_SOURCES] } },
      { source: null, sourceKey: { startsWith: MANUAL_BONUS_SOURCE_KEY_PREFIX } },
    ],
  };
}

export type BonusOrigin = "automatic" | "manual";

export function bonusOrigin(source: string | null | undefined): BonusOrigin {
  return source && (BONUS_SOURCES as readonly string[]).includes(source) ? "automatic" : "manual";
}

/** Whole cents only: a dollar amount with at most two decimals. */
function isWholeCents(value: number): boolean {
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
}

export const manualBonusSchema = z
  .object({
    cleanerId: z.string().trim().min(1).max(200),
    amount: z
      .number({ invalid_type_error: "Enter the amount in dollars." })
      .finite()
      .min(MANUAL_BONUS_MIN_AMOUNT, `A quality bonus is at least $${MANUAL_BONUS_MIN_AMOUNT}.`)
      .max(MANUAL_BONUS_MAX_AMOUNT, `A quality bonus is at most $${MANUAL_BONUS_MAX_AMOUNT}. Use Pay adjustments for a larger payment.`)
      .refine(isWholeCents, "Use dollars and cents (two decimals at most)."),
    reason: z
      .string()
      .trim()
      .min(MANUAL_BONUS_REASON_MIN, "A reason is required.")
      .max(MANUAL_BONUS_REASON_MAX),
    /** The hub period the figures were read for (same values as the URL). */
    period: z.string().trim().max(20).optional(),
    from: z.string().trim().max(20).optional(),
    to: z.string().trim().max(20).optional(),
    idempotencyKey: z.string().trim().min(8).max(80).regex(/^[A-Za-z0-9:_-]+$/),
    /** Set after the dialog showed the "a bonus is already pending" warning. */
    acknowledgePending: z.boolean().optional(),
  })
  .strict();

export type ManualBonusInput = z.infer<typeof manualBonusSchema>;

/** The period and figures the proposal relates to, read on the server. */
export type ManualBonusBasis = {
  periodLabel: string;
  fromKey: string | null;
  toKey: string;
  cleans: number;
  reviewed: number;
  avgScore: number | null;
  currentStreak: number | null;
};

export function basisSentence(basis: ManualBonusBasis | null): string {
  if (!basis) return "No quality figures were found for this cleaner in the period.";
  const score = basis.avgScore === null ? "no reviewed score" : `average score ${Math.round(basis.avgScore)}`;
  const streak = basis.currentStreak === null ? "" : `, current streak ${basis.currentStreak}`;
  return `${basis.periodLabel}: ${basis.cleans} clean${basis.cleans === 1 ? "" : "s"}, ${basis.reviewed} reviewed, ${score}${streak}.`;
}

export type PendingBonusSummary = {
  id: string;
  title: string;
  amount: number | null;
  origin: BonusOrigin;
  createdAt: string;
};

export type ManualBonusResult = {
  id: string;
  duplicate: boolean;
  /** Where the proposal waits for its decision. */
  approvalsHref: string;
};

export const APPROVALS_HREF = "/v2/admin/approvals";
