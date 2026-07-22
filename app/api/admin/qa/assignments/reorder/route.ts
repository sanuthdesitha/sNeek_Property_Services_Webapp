import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";

/**
 * PATCH /api/admin/qa/assignments/reorder
 *
 * Writes the inspector's visit order for a day as 1-based `sequence` values, in
 * one transaction so a partial reorder can never leave duplicate positions.
 * Body: { inspectorId, date, orderedAssignmentIds: string[] }
 */
const bodySchema = z.object({
  inspectorId: z.string().trim().min(1),
  /** The day being ordered (YYYY-MM-DD, Sydney) — advisory, recorded in the audit. */
  date: z.string().trim().min(1).max(32),
  orderedAssignmentIds: z.array(z.string().trim().min(1)).min(1).max(200),
});

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json());

    const ids = Array.from(new Set(body.orderedAssignmentIds));
    if (ids.length !== body.orderedAssignmentIds.length) {
      return NextResponse.json({ error: "Duplicate assignment ids in the order." }, { status: 400 });
    }

    // Every id must belong to THIS inspector — otherwise a reorder could quietly
    // renumber another inspector's day.
    const owned = await db.qaAssignment.findMany({
      where: { id: { in: ids }, assignedToId: body.inspectorId },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      return NextResponse.json(
        { error: "One or more assignments are not assigned to this inspector." },
        { status: 400 }
      );
    }

    await db.$transaction(
      ids.map((id, index) =>
        db.qaAssignment.update({ where: { id }, data: { sequence: index + 1 } })
      )
    );

    await db.auditLog
      .create({
        data: {
          userId: session.user.id,
          action: "QA_ASSIGNMENT_REORDER",
          entity: "QaAssignment",
          entityId: ids.join(","),
          after: { inspectorId: body.inspectorId, date: body.date, order: ids } as any,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ok: true, updated: ids.length });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
