import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { clockOutCleaner } from "@/lib/jobs/clock";
import { ActionReceiptError, withCleanerAction } from "@/lib/cleaner/action-receipt";

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
      const { stopped, durationM } = await clockOutCleaner({ jobId: params.id, userId: session.user.id, tx });
      return { status: 200, body: { ok: true, durationM, alreadyStopped: !stopped } };
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: any) {
    const status = err instanceof ActionReceiptError ? err.status : err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
