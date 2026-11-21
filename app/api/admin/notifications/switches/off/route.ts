import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listSwitchedOff } from "@/lib/notifications/personal/off-list";
import { SWITCH_HEADERS, switchesErrorResponse } from "@/lib/notifications/personal/route-support";

export const dynamic = "force-dynamic";

/** Everyone who has switched something off. ADMIN and OPS_MANAGER (read only). */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json({ people: await listSwitchedOff() }, { headers: SWITCH_HEADERS });
  } catch (error) {
    return switchesErrorResponse(error, null, "The list could not be loaded.");
  }
}
