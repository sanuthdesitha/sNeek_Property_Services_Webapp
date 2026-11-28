/**
 * Re-confirm a job's start briefing after it changed (guest timing above all).
 *
 * The start gate (POST /api/cleaner/jobs/[id]/start) asks for the briefing
 * before a cleaner's FIRST start only: a resume is never blocked, so a cleaner
 * whose clock is already running is not stranded. When the office changes the
 * late checkout or early check-in time after that, the stored confirmation no
 * longer matches (lib/jobs/job-page/timing-ack.ts) and the job screen asks the
 * cleaner to read the briefing again. This route records that new reading.
 *
 * The same rules as the start gate: every current item must be ticked, and
 * the fingerprint of the list the cleaner was shown must match the list as it
 * stands now. An acknowledgement is the cleaner's own statement, so it is
 * refused while an administrator is acting as the cleaner. The write is
 * guarded on the notes it read, so a concurrent office edit is not
 * overwritten and is never acknowledged unseen.
 */
import { NextRequest, NextResponse } from "next/server";
import { JobAssignmentResponseStatus, JobStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  buildStartBriefingAck,
  checkIncomingAckVersion,
  validateStartBriefingAck,
} from "@/lib/forms/start-briefing";
import { loadStartBriefingItems } from "@/lib/forms/start-briefing-load";
import { reminderSource } from "@/lib/pilots/gates";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";

const schema = z.object({
  startBriefingAck: z
    .array(z.object({ itemId: z.string().trim().min(1), at: z.string().optional() }))
    .min(1)
    .max(60),
  startBriefingHash: z.string().trim().min(1).max(64),
});

const FINISHED_STATUSES: JobStatus[] = [
  JobStatus.SUBMITTED,
  JobStatus.QA_REVIEW,
  JobStatus.COMPLETED,
  JobStatus.INVOICED,
];

const privateHeaders = { "Cache-Control": "private, no-store" };

function refuse(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status, headers: privateHeaders });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    if (session.impersonation) {
      return refuse(403, "Only the cleaner can confirm they have read the briefing.", { code: "IMPERSONATION_NOT_ALLOWED" });
    }
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return refuse(400, "Tick every item before you confirm.");

    const assignment = await db.jobAssignment.findFirst({
      where: { jobId: params.id, userId: session.user.id, removedAt: null },
      select: { responseStatus: true },
    });
    if (!assignment) return refuse(403, "Not assigned to this job");
    if (assignment.responseStatus !== JobAssignmentResponseStatus.ACCEPTED) {
      return refuse(409, "Accept the job before you confirm its briefing.");
    }

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: { id: true, status: true, internalNotes: true, propertyId: true, property: { select: { features: true } } },
    });
    if (!job) return refuse(404, "Job not found");
    if (FINISHED_STATUSES.includes(job.status)) return refuse(409, "This job is already finished.");

    const meta = parseJobInternalNotes(job.internalNotes);
    const items = await loadStartBriefingItems(job.id, meta, await reminderSource(job.property, { userId: session.user.id, propertyId: job.propertyId }, job.id));
    if (items.length === 0) return refuse(409, "This job has nothing to confirm.");

    const incomingAck = buildStartBriefingAck(items, parsed.data.startBriefingAck);
    const versionCheck = checkIncomingAckVersion(items, parsed.data.startBriefingHash);
    const check = versionCheck.ok ? validateStartBriefingAck(items, incomingAck) : versionCheck;
    if (!check.ok) {
      return refuse(
        409,
        check.reason === "STALE"
          ? "This job's instructions changed since you read them. Please read them again."
          : "Tick every item before you confirm.",
        { code: "START_BRIEFING_REQUIRED", reason: check.reason, items },
      );
    }

    const nextNotes = serializeJobInternalNotes({
      ...meta,
      startBriefingAcks: { ...(meta.startBriefingAcks ?? {}), [session.user.id]: incomingAck },
    });
    // Guarded on the notes this request read: if the office saved a change in
    // between, nothing is written and the cleaner reads the new version.
    const written = await db.job.updateMany({
      where: { id: job.id, internalNotes: job.internalNotes },
      data: { internalNotes: nextNotes ?? null },
    });
    if (written.count !== 1) {
      return refuse(409, "This job changed while you were reading. Please read it again.", { code: "BRIEFING_CHANGED" });
    }
    return NextResponse.json({ ok: true, status: "current" }, { headers: privateHeaders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") return refuse(401, "Sign in again.");
    if (message === "FORBIDDEN") return refuse(403, "Not allowed.");
    return refuse(500, "Your confirmation could not be saved. Try again.");
  }
}
