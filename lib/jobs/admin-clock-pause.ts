import "server-only";
/**
 * Administrator clock pause (Live ops, "off site with the clock running").
 *
 * It is the cleaner's own Pause, made by an administrator:
 * - The same `clockOutCleaner` the cleaner's Stop/Pause route and the NFC tap
 *   use, so the same Job row lock (SELECT … FOR UPDATE), the same duration
 *   formula, the same "close only if still open" guard, and the same status
 *   rule (IN_PROGRESS becomes PAUSED; any other status is left alone).
 * - Only that cleaner's OPEN log for the job is closed, at now. Closed logs
 *   and recorded time are never touched; nothing is deleted.
 * - The log's notes gain "Paused by the office: <reason>" (how automatic
 *   clock-outs mark a stop the cleaner did not make), and an ADMIN_CLOCK_PAUSE
 *   audit row records who paused, why and what was closed, in the same
 *   transaction.
 * - No open log means nothing to pause: ClockPauseError(409, "No running clock").
 *
 * The cleaner resumes through their existing Resume clock (POST
 * /api/cleaner/jobs/[id]/start), which opens a new log. The notice to the
 * cleaner is sent after the commit, so a notification problem never undoes
 * the pause; its truthful states are returned.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { clockOutCleaner } from "@/lib/jobs/clock";
import { sendClockPausedNotice } from "@/lib/notifications/office-actions";
import type { RecipientOutcome } from "@/lib/notifications/office-sends";

export class ClockPauseError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export type ClockPauseInput = {
  jobId: string;
  cleanerId: string;
  reason: string;
  actorId: string;
  transports: Array<"PUSH" | "EMAIL">;
  now?: Date;
};

export type ClockPauseResult = {
  timeLogId: string;
  stoppedAt: string;
  durationM: number;
  jobStatus: string;
  notice: RecipientOutcome[];
  /** Set when the pause was recorded but the notice could not be queued at all. */
  noticeError: string | null;
};

export const ADMIN_PAUSE_NOTE_PREFIX = "Paused by the office:";

export async function pauseCleanerClockByOffice(input: ClockPauseInput): Promise<ClockPauseResult> {
  const job = await db.job.findUnique({
    where: { id: input.jobId },
    select: { id: true, jobNumber: true, property: { select: { name: true } } },
  });
  if (!job) throw new ClockPauseError(404, "Job not found.");
  const cleaner = await db.user.findUnique({ where: { id: input.cleanerId }, select: { id: true, role: true, name: true, email: true } });
  if (!cleaner) throw new ClockPauseError(404, "Cleaner not found.");

  const now = input.now ?? new Date();
  const note = `${ADMIN_PAUSE_NOTE_PREFIX} ${input.reason}`;
  const closed = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const result = await clockOutCleaner({ jobId: job.id, userId: cleaner.id, now, tx, note });
    if (!result.stopped || !result.clockOut) return null;
    const after = await tx.job.findUnique({ where: { id: job.id }, select: { status: true } });
    await tx.auditLog.create({
      data: {
        userId: input.actorId,
        jobId: job.id,
        action: "ADMIN_CLOCK_PAUSE",
        entity: "TimeLog",
        entityId: result.clockOut.timeLogId,
        after: {
          cleanerId: cleaner.id,
          reason: input.reason,
          stoppedAt: result.clockOut.stoppedAt,
          durationM: result.durationM,
          jobStatusAfter: after?.status ?? null,
          transports: input.transports,
        },
      },
    });
    return { ...result.clockOut, durationM: result.durationM, jobStatus: String(after?.status ?? "") };
  });
  if (!closed) throw new ClockPauseError(409, "No running clock");

  const jobLabel = `${job.property?.name ?? "the job"}${job.jobNumber ? ` (${job.jobNumber})` : ""}`;
  let notice: RecipientOutcome[] = [];
  let noticeError: string | null = null;
  try {
    notice = await sendClockPausedNotice({
      actorId: input.actorId,
      jobId: job.id,
      jobLabel,
      cleaner,
      reason: input.reason,
      timeLogId: closed.timeLogId,
      stoppedAt: new Date(closed.stoppedAt),
      transports: input.transports,
    });
  } catch {
    noticeError = "The clock was paused, but the notice to the cleaner could not be queued. Tell them directly.";
  }
  return { timeLogId: closed.timeLogId, stoppedAt: closed.stoppedAt, durationM: closed.durationM, jobStatus: closed.jobStatus, notice, noticeError };
}
