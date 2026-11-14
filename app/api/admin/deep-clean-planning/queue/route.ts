import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { buildDeepCleanQueue } from "@/lib/properties/deep-clean-queue";

export const dynamic = "force-dynamic";

/**
 * Deep-clean scheduling queue (2026-11-16): every stored plan as a row, the
 * tiles and the properties with no verified deep clean. ADMIN and OPS_MANAGER
 * read it (Properties pack, middleware); only ADMIN may verify or choose a day
 * (the property route's POST is ADMIN only), so `canManage` is ADMIN.
 */
export async function GET() {
  let session;
  try {
    session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "FORBIDDEN";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
  try {
    const canManage = (session.user.heldRoles ?? [session.user.role]).includes(Role.ADMIN);
    return NextResponse.json(await buildDeepCleanQueue(canManage), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The queue could not be loaded." }, { status: 500 });
  }
}
