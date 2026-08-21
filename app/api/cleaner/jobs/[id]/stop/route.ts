import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { clockOutCleaner } from "@/lib/jobs/clock";

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
    const { stopped, durationM } = await clockOutCleaner({
      jobId: params.id,
      userId: session.user.id,
    });

    if (!stopped)
      return NextResponse.json({ error: "No active time log" }, { status: 400 });

    return NextResponse.json({ ok: true, durationM });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
