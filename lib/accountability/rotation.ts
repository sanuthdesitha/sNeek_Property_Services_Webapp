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
 * Strip a compose repeat suffix (`__bed2`, `__bath3`) off a field id so it maps
 * back to the underlying library item key. No suffix → returned unchanged.
 */
export function stripRepeatSuffix(fieldId: string): string {
  return fieldId.replace(/__(?:bed|bath)\d+$/, "");
}

/** A single completed check: a media/upload field with keys, or a truthy answer. */
function isFieldCompleted(
  field: { id: string; type?: unknown },
  answers: Record<string, unknown>,
  media: Record<string, string[]>
): boolean {
  const uploads = media[field.id];
  if (Array.isArray(uploads) && uploads.length > 0) return true;
  const value = answers[field.id];
  if (value === true) return true;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return true;
  return false;
}

/**
 * Pure derivation of rotational completion from a submitted form's schema
 * snapshot + the cleaner's answers + uploaded media (fieldId → keys).
 *
 * A field is rotational when it carries `frequency: "ROTATIONAL"` (emitted by
 * compose). Field ids are mapped back to library item keys by stripping the
 * per-room repeat suffix, so a repeated room's rotational field (`x__bed2`)
 * folds onto the same item key. `allRotationalItemKeys` = every rotational item
 * present in the schema this clean; `completedItemKeys` = those whose evidence
 * (photo/answer) is present.
 */
export function deriveRotationalCompletion(
  schemaSections: unknown,
  answers: Record<string, unknown>,
  media: Record<string, string[]>
): { completedItemKeys: string[]; allRotationalItemKeys: string[] } {
  const all = new Set<string>();
  const completed = new Set<string>();

  const visit = (field: any) => {
    if (!field || typeof field !== "object") return;
    if (typeof field.id === "string" && field.frequency === "ROTATIONAL") {
      const itemKey = stripRepeatSuffix(field.id);
      all.add(itemKey);
      if (isFieldCompleted(field, answers, media)) completed.add(itemKey);
    }
    if (Array.isArray(field.children)) field.children.forEach(visit);
  };

  const sections = Array.isArray(schemaSections) ? schemaSections : [];
  for (const section of sections as any[]) {
    if (!section || !Array.isArray(section.fields)) continue;
    section.fields.forEach(visit);
  }

  return {
    completedItemKeys: Array.from(completed),
    allRotationalItemKeys: Array.from(all),
  };
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
