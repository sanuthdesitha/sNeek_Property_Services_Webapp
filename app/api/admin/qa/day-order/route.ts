import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { clearOfficeDayLock, getDayOrderState, resolveDayKey } from "@/lib/qa/day-order";

/**
 * Office view of who set an inspector's visit order (lib/qa/day-order.ts).
 * Same rights as the office reorder: ADMIN / OPS_MANAGER, with quality at
 * manage for the DELETE through the live session's ops check.
 *
 * GET    ?inspectorId=…&date=…  → { dayOrder }
 * DELETE ?inspectorId=…&date=…  → "Let inspector reorder": clears the lock.
 *        The order itself stays; the inspector may now change it. Audited.
 */
function readTarget(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const inspectorId = params.get("inspectorId")?.trim() || null;
  const dayKey = resolveDayKey(params.get("date"));
  return { inspectorId, dayKey };
}

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "Request failed";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { inspectorId, dayKey } = readTarget(req);
    if (!inspectorId || !dayKey) {
      return NextResponse.json({ error: "Choose an inspector and a day." }, { status: 400 });
    }
    return NextResponse.json({ dayOrder: await getDayOrderState(inspectorId, dayKey) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { inspectorId, dayKey } = readTarget(req);
    if (!inspectorId || !dayKey) {
      return NextResponse.json({ error: "Choose an inspector and a day." }, { status: 400 });
    }
    const dayOrder = await clearOfficeDayLock({ inspectorId, actorId: session.user.id, dayKey });
    return NextResponse.json({ ok: true, dayOrder });
  } catch (err) {
    return errorResponse(err);
  }
}
