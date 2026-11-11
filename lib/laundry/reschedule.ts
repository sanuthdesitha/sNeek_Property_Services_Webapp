/**
 * Moving laundry runs to another day (one card's "Move to …" or a bulk move).
 *
 * The write is the same date change the admin edit PATCH makes (pickup and
 * drop-off stored as date-only `YYYY-MM-DDT00:00:00.000Z`, as the edit dialog
 * sends them), with the stale-write guard the laundry status routes use: each
 * row carries the `updatedAt` the screen saw, and a run that changed since is
 * refused, never overwritten.
 *
 * What moves:
 *   not yet picked up (PENDING, CONFIRMED, FLAGGED): pickup goes to the new day
 *     and the drop-off keeps the same number of days after it;
 *   PICKED_UP: only the drop-off moves, never to before the pickup;
 *   DROPPED or SKIPPED_PICKUP: refused (nothing left to move).
 * Statuses are never changed here.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dateOnlyIso, planReschedule } from "@/lib/laundry/reschedule-dates";

export { dateOnlyIso, planReschedule } from "@/lib/laundry/reschedule-dates";
export type { ReschedulePlan, ReschedulePlanInput } from "@/lib/laundry/reschedule-dates";

export type RescheduleRow = { id: string; expectedUpdatedAt: string };

export type RescheduleOutcome =
  | { id: string; outcome: "done"; pickupDate: string; dropoffDate: string; updatedAt: string }
  | { id: string; outcome: "refused"; reason: string };

export const STALE_RUN_MESSAGE = "This run changed since you loaded it. Refresh and review it before moving it.";

class RowRefusal extends Error {}

export async function rescheduleLaundryRuns(rows: RescheduleRow[], toKey: string, actorId: string): Promise<RescheduleOutcome[]> {
  const outcomes: RescheduleOutcome[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    try {
      const result = await db.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`SELECT "id" FROM "LaundryTask" WHERE "id" = ${row.id} FOR UPDATE`;
        const task = await tx.laundryTask.findUnique({
          where: { id: row.id },
          select: { id: true, jobId: true, status: true, pickupDate: true, dropoffDate: true, pickedUpAt: true, updatedAt: true },
        });
        if (!task) throw new RowRefusal("Laundry run not found.");
        const expected = new Date(row.expectedUpdatedAt).getTime();
        if (Number.isNaN(expected) || task.updatedAt.getTime() !== expected) throw new RowRefusal(STALE_RUN_MESSAGE);
        const plan = planReschedule(task, toKey);
        if (!plan.ok) throw new RowRefusal(plan.reason);
        const updated = await tx.laundryTask.update({
          where: { id: task.id },
          data: { pickupDate: new Date(dateOnlyIso(plan.pickupKey)), dropoffDate: new Date(dateOnlyIso(plan.dropoffKey)) },
          select: { pickupDate: true, dropoffDate: true, updatedAt: true },
        });
        await tx.auditLog.create({
          data: {
            userId: actorId,
            jobId: task.jobId,
            action: "LAUNDRY_RESCHEDULE",
            entity: "LaundryTask",
            entityId: task.id,
            before: { pickupDate: task.pickupDate.toISOString(), dropoffDate: task.dropoffDate.toISOString() },
            after: { pickupDate: updated.pickupDate.toISOString(), dropoffDate: updated.dropoffDate.toISOString(), toDay: toKey },
          },
        });
        return updated;
      });
      outcomes.push({
        id: row.id,
        outcome: "done",
        pickupDate: result.pickupDate.toISOString(),
        dropoffDate: result.dropoffDate.toISOString(),
        updatedAt: result.updatedAt.toISOString(),
      });
    } catch (error) {
      outcomes.push({ id: row.id, outcome: "refused", reason: error instanceof RowRefusal ? error.message : "Could not move this run." });
    }
  }
  return outcomes;
}
