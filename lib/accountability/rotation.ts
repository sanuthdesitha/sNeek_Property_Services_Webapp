import { db } from "@/lib/db";

/**
 * Rotational-evidence scheduling for ROTATIONAL checklist items.
 *
 * A rotational item (e.g. "clean the top of the cupboards") is not required on
 * every clean — it comes due every N standard cleans. Per-property progress is
 * tracked in `PropertyRotationState.cleansSinceDone`, and compose-time
 * inclusion asks {@link isRotationalItemDue} whether the item is due this visit.
 *
 * The helpers here are deliberately split:
 *  - {@link isRotationalItemDue} is pure (unit-tested without a DB),
 *  - {@link getRotationDueMap} is the read used at compose time,
 *  - {@link applyRotationCompletion} is the write used inside the cleaner-submit
 *    transaction (built + unit-tested here; called by a later phase).
 */

/** Minimal rotation-state shape the pure due-check needs. */
export interface RotationStateLike {
  cleansSinceDone: number;
}

/**
 * Is a rotational item due on the current clean?
 *
 *  - No cadence (null / undefined / non-positive / NaN) → never due (false).
 *  - No state row (item has never been completed for this property) → due.
 *  - Otherwise due once `cleansSinceDone + 1 >= cadence` (i.e. counting this
 *    clean would reach the cadence).
 */
export function isRotationalItemDue(
  state: RotationStateLike | null | undefined,
  cadence: number | null | undefined
): boolean {
  if (cadence == null || !Number.isFinite(cadence) || cadence <= 0) return false;
  if (!state) return true; // never done → due
  const since = Number(state.cleansSinceDone);
  if (!Number.isFinite(since)) return true;
  return since + 1 >= cadence;
}

/**
 * Build a `{ itemKey → due }` map for the given rotational items of a property,
 * reading the stored PropertyRotationState rows once. Items without a cadence
 * resolve to `false`.
 */
export async function getRotationDueMap(
  propertyId: string,
  items: { key: string; rotationEveryNCleans: number | null }[]
): Promise<Record<string, boolean>> {
  const due: Record<string, boolean> = {};
  if (items.length === 0) return due;

  const states = await db.propertyRotationState.findMany({
    where: { propertyId, itemKey: { in: items.map((i) => i.key) } },
    select: { itemKey: true, cleansSinceDone: true },
  });
  const byKey = new Map<string, RotationStateLike>();
  for (const s of states) byKey.set(s.itemKey, { cleansSinceDone: s.cleansSinceDone });

  for (const item of items) {
    due[item.key] = isRotationalItemDue(byKey.get(item.key) ?? null, item.rotationEveryNCleans);
  }
  return due;
}

/**
 * Prisma client / transaction-client surface used by
 * {@link applyRotationCompletion}. Typed loosely so any of the app's Prisma
 * clients (the root client or an interactive `$transaction` client) can be
 * passed in.
 */
export interface RotationTxClient {
  propertyRotationState: {
    upsert: (args: any) => Promise<unknown>;
  };
}

/**
 * Record a clean's outcome against the property's rotational items — call this
 * inside the cleaner-submit transaction.
 *
 *  - `completedItemKeys` → reset: `cleansSinceDone = 0`, stamp `lastCompletedAt`
 *    / `lastCompletedJobId`.
 *  - every other key in `allRotationalItemKeys` → `cleansSinceDone += 1`.
 *
 * Rows are upserted, so a property that has never tracked an item starts it at
 * the right value (0 when completed this clean, 1 when skipped).
 */
export async function applyRotationCompletion(
  tx: RotationTxClient,
  params: {
    propertyId: string;
    jobId: string;
    completedItemKeys: string[];
    allRotationalItemKeys: string[];
  }
): Promise<void> {
  const now = new Date();
  const completed = new Set(params.completedItemKeys);

  for (const itemKey of Array.from(completed)) {
    await tx.propertyRotationState.upsert({
      where: { propertyId_itemKey: { propertyId: params.propertyId, itemKey } },
      create: {
        propertyId: params.propertyId,
        itemKey,
        cleansSinceDone: 0,
        lastCompletedAt: now,
        lastCompletedJobId: params.jobId,
      },
      update: {
        cleansSinceDone: 0,
        lastCompletedAt: now,
        lastCompletedJobId: params.jobId,
      },
    });
  }

  for (const itemKey of params.allRotationalItemKeys) {
    if (completed.has(itemKey)) continue;
    await tx.propertyRotationState.upsert({
      where: { propertyId_itemKey: { propertyId: params.propertyId, itemKey } },
      create: { propertyId: params.propertyId, itemKey, cleansSinceDone: 1 },
      update: { cleansSinceDone: { increment: 1 } },
    });
  }
}
