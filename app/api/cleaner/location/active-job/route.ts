import { NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Lightweight "does this cleaner have a live job right now?" probe. The
 * persistent location tracker (mounted in the cleaner layout) polls this so it
 * knows whether to keep the GPS watch + heartbeat running, independent of which
 * screen the cleaner is on. Tracking must persist for the WHOLE active-job
 * window — EN_ROUTE, IN_PROGRESS, PAUSED — and stop only once the job leaves it
 * (submitted / completed / cancelled).
 */
const TRACKING_STATUSES: JobStatus[] = [
  JobStatus.EN_ROUTE,
  JobStatus.IN_PROGRESS,
  JobStatus.PAUSED,
];

export async function GET() {
  try {
    const session = await requireRole([Role.CLEANER]);

    const job = await db.job.findFirst({
      where: {
        status: { in: TRACKING_STATUSES },
        assignments: { some: { userId: session.user.id, removedAt: null } },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, status: true },
    });

    return NextResponse.json({
      job: job ? { id: job.id, status: job.status } : null,
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 500;
    // Never surface an error the tracker would treat as "keep pinging" — just
    // report no active job so it stands down quietly.
    return NextResponse.json({ job: null }, { status });
  }
}
