import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  getDayOrderState,
  OFFICE_LOCK_REASON,
  reorderOwnDay,
  resolveDayKey,
} from "@/lib/qa/day-order";

/**
 * The inspector's own visit order (owner decision 2026-11-12).
 *
 * GET   ?date=today|tomorrow|YYYY-MM-DD → { dayOrder } for the signed-in
 *       inspector's own day: whether the office has set (locked) it and who.
 * PATCH { date, orderedAssignmentIds, expectedOrder } → reorder own day.
 *
 * Live session guard on every call (requireRole re-reads the user and their
 * roles). Only someone holding QA_INSPECTOR, only their own active visits for
 * that day, never while an administrator is testing as them, never over an
 * office lock ("Order set by the office"), and only when `expectedOrder` is
 * still the stored order (409 otherwise). Audited in lib/qa/day-order.ts.
 * The office keeps PATCH /api/admin/qa/assignments/reorder.
 */
const patchSchema = z.object({
  date: z.string().trim().min(1).max(32),
  orderedAssignmentIds: z.array(z.string().trim().min(1)).min(1).max(200),
  /** The order the screen last read, before the move. */
  expectedOrder: z.array(z.string().trim().min(1)).max(200),
});

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "Request failed";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.QA_INSPECTOR, Role.ADMIN, Role.OPS_MANAGER]);
    const dayKey = resolveDayKey(new URL(req.url).searchParams.get("date"));
    if (!dayKey) return NextResponse.json({ error: "Choose a day." }, { status: 400 });
    const dayOrder = await getDayOrderState(session.user.id, dayKey);
    return NextResponse.json({ dayOrder });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole([Role.QA_INSPECTOR]);
    if (session.impersonation) {
      return NextResponse.json(
        { error: "The visit order cannot be changed while testing as someone else.", code: "IMPERSONATING" },
        { status: 403 }
      );
    }
    const body = patchSchema.parse(await req.json());
    const dayKey = resolveDayKey(body.date);
    if (!dayKey) return NextResponse.json({ error: "Choose a day." }, { status: 400 });

    const result = await reorderOwnDay({
      inspectorId: session.user.id,
      dayKey,
      orderedAssignmentIds: body.orderedAssignmentIds,
      expectedOrder: body.expectedOrder,
    });
    switch (result.kind) {
      case "saved":
        return NextResponse.json({ ok: true, updated: result.updated, dayOrder: result.state });
      case "locked":
        return NextResponse.json(
          { error: OFFICE_LOCK_REASON, code: "OFFICE_LOCK", dayOrder: result.state },
          { status: 409 }
        );
      case "stale":
        return NextResponse.json(
          {
            error: "Your visit order changed since it was loaded. It has been reloaded; try the move again.",
            code: "STALE_ORDER",
            currentOrder: result.currentOrder,
          },
          { status: 409 }
        );
      case "invalid":
      default:
        return NextResponse.json({ error: result.message, code: "NOT_YOUR_DAY" }, { status: 403 });
    }
  } catch (err) {
    return errorResponse(err);
  }
}
