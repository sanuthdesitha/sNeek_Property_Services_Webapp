/**
 * Previous-clean laundry cycle resolver.
 *
 * When a cleaner opens an Airbnb turnover, the laundry information they need is
 * the cycle BELONGING TO THE PREVIOUS CLEAN of the SAME property: linen from the
 * 3-July clean is picked up on the 4th and dropped on the 5th so it's ready for
 * the clean on the 6th. The job opened on the 6th must therefore show that
 * 4–5 July task — never "the last drop at this property from any job", which is
 * what the old `laundryGuidance` block surfaced and what kept reading like the
 * wrong property/job.
 *
 * Selection (pure in `pickPreviousCleanJob`, unit-tested):
 *   latest OTHER AIRBNB_TURNOVER, non-rework job at the property scheduled
 *   BEFORE the current job that actually HAS a LaundryTask.
 *
 * Drop proof (pure in `pickDropConfirmation`, unit-tested):
 *   the LATEST confirmation whose notes-meta `event` is "DROPPED". Statuses can
 *   be reverted (REVERT_TO_PICKED_UP / REVERT_TO_CONFIRMED write their own
 *   confirmation rows) and then re-dropped — the latest DROPPED event always
 *   wins, and revert rows are simply ignored.
 */
import type { PrismaClient } from "@prisma/client";
import { parseLaundryConfirmationMeta } from "@/lib/laundry/media";

// ── Pure helpers ─────────────────────────────────────────────────────────────

export type DropConfirmationLike = {
  id: string;
  photoUrl?: string | null;
  s3Key?: string | null;
  notes?: string | null;
  bagLocation?: string | null;
  createdAt: Date | string;
};

/**
 * Latest DROPPED-event confirmation (by createdAt), tolerant of reverts: rows
 * for REVERT_* / PICKED_UP / plain cleaner proofs never match, and when a task
 * was dropped → reverted → dropped again, the newest DROPPED row wins.
 */
export function pickDropConfirmation<T extends DropConfirmationLike>(
  confirmations: T[] | null | undefined,
): T | null {
  if (!Array.isArray(confirmations)) return null;
  return (
    [...confirmations]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .find((c) => {
        const meta = parseLaundryConfirmationMeta(c.notes) as Record<string, unknown>;
        return String(meta.event ?? "").trim().toUpperCase() === "DROPPED";
      }) ?? null
  );
}

export type PreviousCleanCandidate = {
  id: string;
  propertyId: string;
  jobType: string;
  isRework?: boolean | null;
  scheduledDate: Date | string;
  laundryTask?: unknown | null;
};

/**
 * The previous clean whose laundry cycle feeds the current job: the latest
 * OTHER non-rework AIRBNB_TURNOVER at the SAME property scheduled before the
 * current job that has a LaundryTask. Pure so the selection rules are testable
 * without Prisma.
 */
export function pickPreviousCleanJob<T extends PreviousCleanCandidate>(
  candidates: T[],
  opts: { propertyId: string; currentJobId: string; currentJobScheduledDate: Date | string },
): T | null {
  const cutoff = new Date(opts.currentJobScheduledDate).getTime();
  return (
    candidates
      .filter(
        (job) =>
          job.propertyId === opts.propertyId &&
          job.id !== opts.currentJobId &&
          job.jobType === "AIRBNB_TURNOVER" &&
          job.isRework !== true &&
          new Date(job.scheduledDate).getTime() < cutoff &&
          job.laundryTask != null,
      )
      .sort(
        (a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime(),
      )[0] ?? null
  );
}

// ── DB resolver ──────────────────────────────────────────────────────────────

export type PreviousLaundryCycle = {
  taskId: string;
  status: string;
  pickupDate: string;
  dropoffDate: string;
  droppedAt: string | null;
  dropPhotoKey?: string | null;
  dropPhotoUrl?: string | null;
  dropNotes?: string | null;
  /** Scheduled date of the previous clean the linen belongs to (ISO). */
  prevCleanDate: string;
};

export async function getPreviousCleanLaundryCycle(
  db: PrismaClient,
  propertyId: string,
  currentJobId: string,
  currentJobScheduledDate: Date,
): Promise<PreviousLaundryCycle | null> {
  // The where-clause narrows for cheapness; the exported pure picker is the
  // single source of truth for the selection rules (and re-applies them).
  const candidates = await db.job.findMany({
    where: {
      propertyId,
      id: { not: currentJobId },
      jobType: "AIRBNB_TURNOVER",
      isRework: false,
      scheduledDate: { lt: currentJobScheduledDate },
      laundryTask: { isNot: null },
    },
    orderBy: { scheduledDate: "desc" },
    take: 10,
    select: {
      id: true,
      propertyId: true,
      jobType: true,
      isRework: true,
      scheduledDate: true,
      laundryTask: {
        select: {
          id: true,
          status: true,
          pickupDate: true,
          dropoffDate: true,
          droppedAt: true,
          confirmations: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              photoUrl: true,
              s3Key: true,
              notes: true,
              bagLocation: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  const prevJob = pickPreviousCleanJob(candidates, {
    propertyId,
    currentJobId,
    currentJobScheduledDate,
  });
  const task = prevJob?.laundryTask;
  if (!prevJob || !task) return null;

  const drop = pickDropConfirmation(task.confirmations);
  const dropMeta = drop
    ? (parseLaundryConfirmationMeta(drop.notes) as Record<string, unknown>)
    : {};
  const metaNote = typeof dropMeta.note === "string" ? dropMeta.note.trim() : "";
  const dropNotes = drop?.bagLocation?.trim() || metaNote || null;

  return {
    taskId: task.id,
    status: task.status,
    pickupDate: new Date(task.pickupDate).toISOString(),
    dropoffDate: new Date(task.dropoffDate).toISOString(),
    droppedAt: task.droppedAt
      ? new Date(task.droppedAt).toISOString()
      : drop
        ? new Date(drop.createdAt).toISOString()
        : null,
    dropPhotoKey: drop?.s3Key ?? null,
    dropPhotoUrl: drop?.photoUrl ?? null,
    dropNotes,
    prevCleanDate: new Date(prevJob.scheduledDate).toISOString(),
  };
}
