import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * Cleaner-facing coaching feed (Phase 7b). Returns the signed-in cleaner's own
 * records across all statuses, newest first. Internal manager identity beyond a
 * display name is intentionally omitted.
 */
export async function GET() {
  try {
    const session = await requireRole([Role.CLEANER]);

    const records = await db.coachingRecord.findMany({
      where: { cleanerId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        createdBy: { select: { name: true } },
      },
    });

    const rows = records.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      reason: r.reason,
      notes: r.notes,
      retrainingRequired: r.retrainingRequired,
      reviewDate: r.reviewDate,
      acknowledgedAt: r.acknowledgedAt,
      outcome: r.outcome,
      createdAt: r.createdAt,
      createdByName: r.createdBy?.name ?? "Management",
    }));

    return NextResponse.json({ records: rows });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed to load records." }, { status });
  }
}
