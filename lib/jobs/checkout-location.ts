import { Prisma } from "@prisma/client";

/** Bind optional GPS to a just-closed, owned clock segment, never a later form. */
export async function recordCheckoutLocation(
  tx: Prisma.TransactionClient,
  input: { jobId: string; userId: string; timeLogId: string; lat: number; lng: number },
  now = new Date(),
): Promise<{ recorded: boolean; reason?: string }> {
  await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${input.jobId} FOR UPDATE`;
  const assignment = await tx.jobAssignment.findFirst({
    where: { jobId: input.jobId, userId: input.userId, removedAt: null },
    select: { id: true },
  });
  if (!assignment) throw new Error("FORBIDDEN");
  const job = await tx.job.findUnique({ where: { id: input.jobId }, select: { status: true } });
  if (!job || ["UNASSIGNED", "OFFERED", "ASSIGNED", "EN_ROUTE"].includes(job.status)) {
    return { recorded: false, reason: "CLOCK_CONTEXT_CHANGED" };
  }
  const log = await tx.timeLog.findFirst({
    where: { jobId: input.jobId, userId: input.userId },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: { id: true, startedAt: true, stoppedAt: true },
  });
  if (!log || log.id !== input.timeLogId || !log.stoppedAt) {
    return { recorded: false, reason: "CLOCK_CONTEXT_CHANGED" };
  }
  // A delayed/replayed request must not attach today's location to an old stop.
  const age = now.getTime() - log.stoppedAt.getTime();
  if (age < 0 || age > 120_000) return { recorded: false, reason: "CLOCK_OUT_LOCATION_EXPIRED" };
  const result = await tx.job.updateMany({
    where: {
      id: input.jobId,
      OR: [{ gpsCheckOutAt: null, gpsCheckOutLat: null, gpsCheckOutLng: null }, { gpsCheckOutAt: { lt: log.startedAt } }],
    },
    data: { gpsCheckOutLat: input.lat, gpsCheckOutLng: input.lng, gpsCheckOutAt: log.stoppedAt },
  });
  return result.count === 1 ? { recorded: true } : { recorded: false, reason: "CLOCK_OUT_ALREADY_RECORDED" };
}
