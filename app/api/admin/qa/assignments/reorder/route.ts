import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { resolveDayKey, setOfficeDayOrder } from "@/lib/qa/day-order";

/**
 * PATCH /api/admin/qa/assignments/reorder (office: ADMIN / OPS_MANAGER, with
 * quality at manage through the live session's ops check).
 *
 * Writes the inspector's visit order for a day as 1-based `sequence` values, in
 * one transaction so a partial reorder can never leave duplicate positions.
 * Ordering ANOTHER inspector's day records it as set by the office and locks
 * it against the inspector's own reorder (lib/qa/day-order.ts); the office
 * clears that with DELETE /api/admin/qa/day-order.
 * Body: { inspectorId, date, orderedAssignmentIds: string[] }
 */
const bodySchema = z.object({
  inspectorId: z.string().trim().min(1),
  /** The day being ordered: today | tomorrow | YYYY-MM-DD (Sydney). */
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
    const dayKey = resolveDayKey(body.date);
    if (!dayKey) {
      return NextResponse.json({ error: "Choose the day this order is for." }, { status: 400 });
    }

    const result = await setOfficeDayOrder({
      inspectorId: body.inspectorId,
      actorId: session.user.id,
      dayKey,
      orderedAssignmentIds: ids,
    });
    if (result.kind === "invalid") {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    await db.auditLog
      .create({
        data: {
          userId: session.user.id,
          action: "QA_ASSIGNMENT_REORDER",
          entity: "QaAssignment",
          entityId: ids.join(","),
          after: {
            inspectorId: body.inspectorId,
            date: dayKey,
            order: ids,
            lockedForInspector: result.state.locked,
            impersonatedBy: session.impersonation?.actorId ?? null,
          },
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ok: true, updated: result.updated, dayOrder: result.state });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
