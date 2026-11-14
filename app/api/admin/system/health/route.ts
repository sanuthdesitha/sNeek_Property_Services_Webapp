import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { readSystemHealth } from "@/lib/ops/system-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * System health ("Check again"). ADMIN only, as the Diagnostics page always
 * was: the live role guard runs on every request. Reads only; never returns a
 * credential value.
 */
export async function GET() {
  try {
    await requireRole([Role.ADMIN]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "FORBIDDEN";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
  try {
    return NextResponse.json(await readSystemHealth(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "System health could not be read." }, { status: 500 });
  }
}
