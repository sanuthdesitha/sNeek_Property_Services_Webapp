import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getApiErrorStatus } from "@/lib/api/http";
import { isPerformanceWindow, loadPerformanceWindow } from "@/lib/workforce/performance-window";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * GET ?window=30|90|365 — one performance window for the retry on the
 * performance page. The same roles as the page. A window that times out or
 * fails answers with that status (and 504 / 500), never with zeros.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);
    const windowDays = Number(req.nextUrl.searchParams.get("window"));
    if (!isPerformanceWindow(windowDays)) return NextResponse.json({ error: "Choose a window of 30, 90 or 365 days." }, { status: 400, headers });
    const person = await db.user.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!person) return NextResponse.json({ error: "Person not found." }, { status: 404, headers });
    const result = await loadPerformanceWindow(person.id, windowDays);
    const status = result.status === "ready" ? 200 : result.status === "timed_out" ? 504 : 500;
    return NextResponse.json(result, { status, headers });
  } catch (err: unknown) {
    const status = getApiErrorStatus(err, 500);
    return NextResponse.json({ error: status === 500 ? "This window could not be worked out." : (err as Error).message }, { status, headers });
  }
}
