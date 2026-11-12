/**
 * Laundry planned pickup / drop clock times (Wave F). Time of day only
 * ("HH:mm", organisation time) on the run's existing pickup and drop days;
 * null means no time was planned and nothing is shown — never a guessed time.
 * The days, statuses and the Calendar's laundry counts are not touched.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

export const CLOCK_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const plannedTimesInput = z.object({
  pickupTime: z.string().regex(CLOCK_TIME, "Use a 24-hour time such as 14:30.").nullable(),
  dropoffTime: z.string().regex(CLOCK_TIME, "Use a 24-hour time such as 14:30.").nullable(),
  expectedUpdatedAt: z.string().datetime().optional(),
}).strict();

export type PlannedTimes = { pickupTime: string | null; dropoffTime: string | null; updatedAt: string };

export async function setLaundryPlannedTimes(actorId: string, taskId: string, raw: unknown): Promise<PlannedTimes> {
  const input = plannedTimesInput.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "LaundryTask" WHERE "id" = ${taskId} FOR UPDATE`;
    const task = await tx.laundryTask.findUnique({ where: { id: taskId }, select: { pickupTime: true, dropoffTime: true, updatedAt: true } });
    if (!task) throw new Error("NOT_FOUND");
    if (input.expectedUpdatedAt && task.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) {
      throw new Error("CONFLICT: This run changed since you opened it. Refresh and review it before saving again.");
    }
    const updated = await tx.laundryTask.update({ where: { id: taskId }, data: { pickupTime: input.pickupTime, dropoffTime: input.dropoffTime }, select: { pickupTime: true, dropoffTime: true, updatedAt: true } });
    await tx.auditLog.create({
      data: {
        userId: actorId, action: "LAUNDRY_PLANNED_TIMES_UPDATED", entity: "LaundryTask", entityId: taskId,
        before: { pickupTime: task.pickupTime, dropoffTime: task.dropoffTime } as Prisma.InputJsonObject,
        after: { pickupTime: updated.pickupTime, dropoffTime: updated.dropoffTime } as Prisma.InputJsonObject,
      },
    });
    return { pickupTime: updated.pickupTime, dropoffTime: updated.dropoffTime, updatedAt: updated.updatedAt.toISOString() };
  });
}
