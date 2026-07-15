import { NextResponse } from "next/server";
import { CoachingRecordStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { notifyCoachingAcknowledged } from "@/lib/notifications/accountability";

/**
 * Cleaner acknowledges one of their own OPEN coaching records (Phase 7b).
 * Only the owning cleaner may act, and only while the record is OPEN — this
 * flips it to ACKNOWLEDGED and stamps acknowledgedAt. Audited.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);

    const record = await db.coachingRecord.findUnique({ where: { id: params.id } });
    if (!record || record.cleanerId !== session.user.id) {
      return NextResponse.json({ error: "Record not found." }, { status: 404 });
    }
    if (record.status !== CoachingRecordStatus.OPEN) {
      return NextResponse.json(
        { error: "This record has already been acknowledged." },
        { status: 409 }
      );
    }

    const updated = await db.$transaction(async (tx) => {
      const next = await tx.coachingRecord.update({
        where: { id: record.id },
        data: {
          status: CoachingRecordStatus.ACKNOWLEDGED,
          acknowledgedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "COACHING_RECORD_ACKNOWLEDGE",
          entity: "CoachingRecord",
          entityId: record.id,
          before: { status: record.status } as any,
          after: { status: next.status, acknowledgedAt: next.acknowledgedAt } as any,
        },
      });

      return next;
    });

    void notifyCoachingAcknowledged({
      createdById: record.createdById,
      coachingId: record.id,
      cleanerName: session.user.name ?? null,
    }).catch(console.error);

    return NextResponse.json({ id: updated.id, status: updated.status, acknowledgedAt: updated.acknowledgedAt });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not acknowledge." }, { status });
  }
}
