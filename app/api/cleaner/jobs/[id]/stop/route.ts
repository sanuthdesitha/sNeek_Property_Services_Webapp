import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { clockOutCleaner } from "@/lib/jobs/clock";
import { ActionReceiptError, withCleanerAction } from "@/lib/cleaner/action-receipt";
import { sendCleanerSharingNotice } from "@/lib/notifications/location-sharing";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER]);

    // Ownership: only the assigned cleaner may pause this job (parity with every
    // other job-scoped cleaner route).
    const assignment = await db.jobAssignment.findFirst({
      where: { jobId: params.id, userId: session.user.id, removedAt: null },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Not assigned to this job" }, { status: 403 });
    }

    // Closing the log and moving the status are one operation — see
    // lib/jobs/clock. A second tap on the property's NFC tag does exactly
    // the same thing, and the two must not drift apart.
    const result = await withCleanerAction({ session, jobId: params.id, action: "stop", requestId: _req.headers.get("X-Cleaner-Action-Id"), draftIdentity: _req.headers.get("X-Cleaner-Draft-Identity"), body: {} }, async tx => {
      const { stopped, durationM, clockOut } = await clockOutCleaner({ jobId: params.id, userId: session.user.id, tx });
      return { status: 200, body: { ok: true, durationM, clockOut: clockOut ?? null, alreadyStopped: !stopped } };
    });
    // Clocking out ends live location for this job: tell the cleaner (inbox
    // only). Never fails the stop; never sent while impersonated.
    const closed = (result.body as { clockOut?: { timeLogId: string } | null }).clockOut;
    if (result.status === 200 && closed?.timeLogId && !session.impersonation) {
      void db.job
        .findUnique({ where: { id: params.id }, select: { jobNumber: true, property: { select: { name: true } } } })
        .then((job) => sendCleanerSharingNotice({
          kind: "stopped", userId: session.user.id, jobId: params.id,
          jobLabel: `${job?.jobNumber || params.id}: ${job?.property?.name ?? "the job"}`,
          occurrenceId: closed.timeLogId,
        }))
        .catch(() => undefined);
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: any) {
    const status = err instanceof ActionReceiptError ? err.status : err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
