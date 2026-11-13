import "server-only";
import { Prisma } from "@prisma/client";

/**
 * A cleaner's laundry outcome that was SAVED while the scheduling rules could
 * not be read (owner decision 2026-11-14: scheduling work fails closed,
 * people's own saves never do). The run itself was not planned; the outcome is
 * kept here, one row per job (`laundry_run_unplanned:<jobId>`, latest wins),
 * and replayed by the hourly retry once the rules can be read again
 * (lib/scheduling-rules/unplanned-laundry-retry.ts).
 */
export const UNPLANNED_LAUNDRY_PREFIX = "laundry_run_unplanned:";
export const UNPLANNED_LAUNDRY_TEXT = "Laundry run not planned: scheduling rules could not be read";

export type UnplannedLaundryOutcome = {
  jobId: string;
  cleanerId: string;
  laundryOutcome: string;
  bagLocation: string | null;
  laundryBagCount: number | null;
  laundryPhotoKey: string | null;
  laundrySkipReasonCode: string | null;
  laundrySkipReasonNote: string | null;
  source: string;
  portalUrl: string;
  reason: string;
  recordedAt: string;
};

export function unplannedLaundryKey(jobId: string): string {
  return `${UNPLANNED_LAUNDRY_PREFIX}${jobId}`;
}

type Client = Pick<Prisma.TransactionClient, "appSetting" | "auditLog">;

/** Keep the outcome and leave an audit row on the job (inside the caller's save). */
export async function recordUnplannedLaundryOutcome(client: Client, outcome: UnplannedLaundryOutcome): Promise<void> {
  const value = outcome as unknown as Prisma.InputJsonObject;
  await client.appSetting.upsert({ where: { key: unplannedLaundryKey(outcome.jobId) }, create: { key: unplannedLaundryKey(outcome.jobId), value }, update: { value } });
  await client.auditLog.create({
    data: {
      userId: outcome.cleanerId,
      jobId: outcome.jobId,
      action: "LAUNDRY_RUN_NOT_PLANNED",
      entity: "Job",
      entityId: outcome.jobId,
      after: { message: UNPLANNED_LAUNDRY_TEXT, reason: outcome.reason, laundryOutcome: outcome.laundryOutcome, source: outcome.source } as Prisma.InputJsonObject,
    },
  });
}

/** The pending note for one job (the job page's laundry stage), or null. */
export async function readUnplannedLaundry(client: Pick<Prisma.TransactionClient, "appSetting">, jobId: string): Promise<UnplannedLaundryOutcome | null> {
  const row = await client.appSetting.findUnique({ where: { key: unplannedLaundryKey(jobId) }, select: { value: true } });
  const value = row?.value as UnplannedLaundryOutcome | undefined;
  return value && typeof value.jobId === "string" ? value : null;
}
