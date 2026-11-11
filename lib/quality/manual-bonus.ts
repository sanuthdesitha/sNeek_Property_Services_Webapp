import "server-only";
/**
 * "Propose bonus" by hand from a cleaner's row (owner decision, sixth set,
 * Wave C). Writes ONE pending pay adjustment the way the admin "add payment"
 * route (POST /api/admin/pay-adjustments) writes a pending one: the same
 * columns and values, FIXED, standalone, SERVICE category, `cleanerNote`
 * "Added by admin.", not reviewed, and the same audit action. That route keeps
 * its write inline (no shared service exists and its code is read-only for
 * this step), so `manualBonusAdjustmentData` mirrors its pending branch field
 * for field and a test pins the two together.
 *
 * What it does NOT do: approve, pay, notify, or change any automatic bonus,
 * deduction, score or coaching rule. The proposal waits in the existing
 * Approvals "Pay requests" queue (source null) and is paid only after the
 * existing approval.
 *
 * Safety:
 * - Idempotent: the client's key is part of `sourceKey`; a replay returns the
 *   first row. Checked under an advisory lock per cleaner, so a double click
 *   cannot create two.
 * - A bonus already pending for the cleaner (automatic or manual) refuses with
 *   409 and the list, unless the caller acknowledges it after seeing it.
 * - The figures it relates to are read here, from the same Cleaners-tab
 *   service, never taken from the browser.
 */
import { PayAdjustmentStatus, PayAdjustmentType, Role, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isTaxableCategory } from "@/lib/finance/pay-categories";
import { getCleanerRows } from "./cleaners";
import { periodLabel, resolveQualityPeriod } from "./period";
import { EMPTY_QUALITY_FILTERS } from "./types";
import {
  APPROVALS_HREF,
  MANUAL_BONUS_ORIGIN,
  MANUAL_BONUS_TITLE,
  basisSentence,
  bonusOrigin,
  manualBonusSchema,
  manualBonusSourceKey,
  pendingBonusWhere,
  type ManualBonusBasis,
  type ManualBonusInput,
  type ManualBonusResult,
  type PendingBonusSummary,
} from "./manual-bonus-rules";

export class ManualBonusError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly pending: PendingBonusSummary[] = [],
  ) {
    super(message);
    this.name = "ManualBonusError";
  }
}

/** The row the admin "add payment" route writes when autoApprove is false. */
export function manualBonusAdjustmentData(input: {
  cleanerId: string;
  amount: number;
  adminNote: string;
  sourceKey: string;
}): Prisma.CleanerPayAdjustmentUncheckedCreateInput {
  return {
    cleanerId: input.cleanerId,
    jobId: null,
    propertyId: null,
    scope: "STANDALONE",
    title: MANUAL_BONUS_TITLE,
    type: PayAdjustmentType.FIXED,
    requestedAmount: Math.abs(input.amount),
    approvedAmount: null,
    status: PayAdjustmentStatus.PENDING,
    adminNote: input.adminNote,
    cleanerNote: "Added by admin.",
    reviewedById: null,
    reviewedAt: null,
    category: "SERVICE",
    taxable: isTaxableCategory("SERVICE"),
    sourceKey: input.sourceKey,
  };
}

async function readBasis(input: ManualBonusInput, now: Date): Promise<ManualBonusBasis | null> {
  const period = resolveQualityPeriod({ period: input.period, from: input.from, to: input.to }, now);
  const { rows } = await getCleanerRows(period, { ...EMPTY_QUALITY_FILTERS, cleanerId: input.cleanerId }, "score", "desc", now);
  const row = rows.find((candidate) => candidate.cleanerId === input.cleanerId);
  if (!row) return null;
  return {
    periodLabel: periodLabel(period),
    fromKey: period.fromKey,
    toKey: period.toKey,
    cleans: row.cleans,
    reviewed: row.reviewed,
    avgScore: row.avgScore,
    currentStreak: row.streak && row.streak.sample > 0 ? row.streak.currentStreak : null,
  };
}

async function pendingFor(tx: Prisma.TransactionClient, cleanerId: string): Promise<PendingBonusSummary[]> {
  const rows = await tx.cleanerPayAdjustment.findMany({
    where: pendingBonusWhere([cleanerId]),
    select: { id: true, title: true, requestedAmount: true, source: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? "Bonus proposal",
    amount: typeof row.requestedAmount === "number" ? row.requestedAmount : null,
    origin: bonusOrigin(row.source),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function proposeManualQualityBonus(actorId: string, raw: unknown, now: Date = new Date()): Promise<ManualBonusResult> {
  const input = manualBonusSchema.parse(raw);
  const cleaner = await db.user.findFirst({ where: { id: input.cleanerId, role: Role.CLEANER }, select: { id: true } });
  if (!cleaner) throw new ManualBonusError(404, "Cleaner not found.");
  const basis = await readBasis(input, now);
  const sourceKey = manualBonusSourceKey(input.cleanerId, input.idempotencyKey);
  const adminNote = `${input.reason}\n\nManual quality bonus proposed from Quality. ${basisSentence(basis)}`;

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quality-bonus:${input.cleanerId}`}))`;
    const replay = await tx.cleanerPayAdjustment.findFirst({
      where: { cleanerId: input.cleanerId, sourceKey },
      select: { id: true },
    });
    if (replay) return { id: replay.id, duplicate: true, approvalsHref: APPROVALS_HREF };

    const pending = await pendingFor(tx, input.cleanerId);
    if (pending.length > 0 && input.acknowledgePending !== true) {
      throw new ManualBonusError(409, "A bonus is already waiting for a decision for this cleaner. Review it, or confirm you want to propose another.", pending);
    }

    const created = await tx.cleanerPayAdjustment.create({
      data: manualBonusAdjustmentData({ cleanerId: input.cleanerId, amount: input.amount, adminNote, sourceKey }),
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "PAY_ADJUSTMENT_ADMIN_CREATED",
        entity: "CleanerPayAdjustment",
        entityId: created.id,
        after: {
          amount: Math.abs(input.amount),
          direction: "ADDITION",
          approved: false,
          jobId: null,
          cleanerId: input.cleanerId,
          correctionOfId: null,
          origin: MANUAL_BONUS_ORIGIN,
          reason: input.reason,
          basis,
          idempotencyKey: input.idempotencyKey,
          pendingAcknowledged: pending.map((row) => row.id),
        },
      },
    });
    return { id: created.id, duplicate: false, approvalsHref: APPROVALS_HREF };
  });
}
