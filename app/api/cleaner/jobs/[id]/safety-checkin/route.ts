import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const job = await db.job.findFirst({
      where: {
        id: params.id,
        assignments: { some: { userId: session.user.id, removedAt: null } },
      },
      select: {
        id: true,
        requiresSafetyCheckin: true,
        safetyCheckinAt: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    if (!job.requiresSafetyCheckin) {
      return NextResponse.json({ error: "Safety check-in is not required for this job." }, { status: 400 });
    }
    if (job.safetyCheckinAt) {
      return NextResponse.json({ ok: true, safetyCheckinAt: job.safetyCheckinAt });
    }

    const updated = await db.job.update({
      where: { id: job.id },
      data: { safetyCheckinAt: new Date() },
      select: { safetyCheckinAt: true },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: job.id,
        action: "SAFETY_CHECKIN_CONFIRMED",
        entity: "Job",
        entityId: job.id,
        after: { safetyCheckinAt: updated.safetyCheckinAt } as any,
      },
    });

    return NextResponse.json({ ok: true, safetyCheckinAt: updated.safetyCheckinAt });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not confirm safety check-in." }, { status });
  }
}
