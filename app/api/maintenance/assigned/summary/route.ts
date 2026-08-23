/**
 * CP-6 — "do I have a maintenance section?" for the signed-in user.
 *
 *   GET /api/maintenance/assigned/summary → { assigned, count, role, href }
 *
 * The v2 portal layouts are client components, so the nav cannot ask the
 * database directly. This is the one small read they poll to decide whether the
 * maintenance entry exists at all. A failure here leaves the nav unchanged
 * (section hidden) rather than breaking the shell.
 */
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import {
  MAINTENANCE_SECTION_HREF,
  assigneeRoleForUserRole,
} from "@/lib/maintenance/assignment-roles";
import { countActiveAssignmentsForUser } from "@/lib/maintenance/assignments";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireSession();
    const role = assigneeRoleForUserRole(session.user.role as Role);
    if (!role) {
      // Admins and clients manage maintenance rather than being assigned to it.
      return NextResponse.json({ assigned: false, count: 0, role: null, href: null });
    }

    // Scoped to the hat this response is about. session.user.role is the ACTIVE
    // role now, so a person who cleans and inspects gets the section for
    // whichever they are currently acting as — and a count that matches what
    // that section will actually list.
    const count = await countActiveAssignmentsForUser(session.user.id, { role });
    return NextResponse.json({
      assigned: count > 0,
      count,
      role,
      href: MAINTENANCE_SECTION_HREF[role],
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
