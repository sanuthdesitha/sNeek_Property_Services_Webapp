import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * DELETE — clears the manuallyRescheduledAt flag so iCal sync can resume
 * overwriting the job's date/time fields normally.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: { id: true, manuallyRescheduledAt: true },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    const updated = await db.job.update({
      where: { id: params.id },
      data: { manuallyRescheduledAt: null, rescheduledBy: null },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: params.id,
        action: "JOB_MANUAL_RESCHEDULE_CLEARED",
        entity: "Job",
        entityId: params.id,
        before: { manuallyRescheduledAt: job.manuallyRescheduledAt } as any,
        after: { manuallyRescheduledAt: null } as any,
      },
    });

    return NextResponse.json({ ok: true, job: updated });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
