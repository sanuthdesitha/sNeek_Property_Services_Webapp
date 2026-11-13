import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { applyCleanerLaundryStatusUpdate, type CleanerLaundryOutcome, type CleanerLaundryUpdateSource } from "@/lib/laundry/cleaner-status";
import { SYSTEM_SCHEDULING_RULES_ACTOR, systemActorMarker } from "@/lib/audit/system-actor";
import { loadSchedulingRuleBook, systemAuditUserId } from "./store";
import { UNPLANNED_LAUNDRY_PREFIX, unplannedLaundryKey, type UnplannedLaundryOutcome } from "./unplanned-laundry";

/**
 * Replays cleaner laundry outcomes that were saved while the rules could not
 * be read: the planner now creates the run (live rules) and the cleaner's
 * outcome is recorded on it exactly as the original update would have. Runs
 * hourly with scheduling-rules-activate. Does nothing while the rules are
 * still unavailable (the rows stay and the job keeps its notice).
 */
export async function retryUnplannedLaundryRuns(): Promise<{ pending: number; planned: number; failed: number }> {
  const rows = await db.appSetting.findMany({ where: { key: { startsWith: UNPLANNED_LAUNDRY_PREFIX } }, select: { key: true, value: true }, take: 200 });
  if (rows.length === 0) return { pending: 0, planned: 0, failed: 0 };
  await loadSchedulingRuleBook(); // throws while still unavailable: nothing is replayed on guessed values
  let planned = 0;
  let failed = 0;
  for (const row of rows) {
    const outcome = row.value as unknown as UnplannedLaundryOutcome;
    if (!outcome || typeof outcome.jobId !== "string" || row.key !== unplannedLaundryKey(outcome.jobId)) continue;
    const afterCommit: Array<() => Promise<void>> = [];
    try {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Job" WHERE "id" = ${outcome.jobId} FOR UPDATE`;
        await applyCleanerLaundryStatusUpdate({
          jobId: outcome.jobId,
          cleanerId: outcome.cleanerId,
          laundryOutcome: outcome.laundryOutcome as CleanerLaundryOutcome,
          bagLocation: outcome.bagLocation,
          laundryBagCount: outcome.laundryBagCount,
          laundryPhotoKey: outcome.laundryPhotoKey,
          laundrySkipReasonCode: outcome.laundrySkipReasonCode,
          laundrySkipReasonNote: outcome.laundrySkipReasonNote,
          source: outcome.source as CleanerLaundryUpdateSource,
          portalUrl: outcome.portalUrl,
        }, { transaction: tx, afterCommit });
        const task = await tx.laundryTask.findUnique({ where: { jobId: outcome.jobId }, select: { id: true } });
        // Still no run (job gone, laundry off, rework): nothing left to plan.
        await tx.appSetting.deleteMany({ where: { key: row.key } });
        const userId = await systemAuditUserId(tx);
        if (userId) {
          await tx.auditLog.create({ data: { userId, jobId: (await tx.job.findUnique({ where: { id: outcome.jobId }, select: { id: true } }))?.id ?? null, action: "LAUNDRY_RUN_PLANNED_AFTER_RETRY", entity: "Job", entityId: outcome.jobId, after: { laundryTaskId: task?.id ?? null, notPlannedAt: outcome.recordedAt, ...systemActorMarker(SYSTEM_SCHEDULING_RULES_ACTOR) } } });
        }
      });
      planned += 1;
      for (const notify of afterCommit) await notify().catch((error) => logger.error({ error, jobId: outcome.jobId }, "Laundry notice after retry failed"));
    } catch (error) {
      failed += 1;
      logger.error({ error, jobId: outcome.jobId }, "Retrying an unplanned laundry run failed");
    }
  }
  return { pending: rows.length, planned, failed };
}
