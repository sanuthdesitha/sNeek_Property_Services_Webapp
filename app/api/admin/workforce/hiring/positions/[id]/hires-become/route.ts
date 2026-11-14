import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { isHireAccountKind } from "@/lib/accounts/create-account-rules";
import { HiringError } from "@/lib/hiring/hire";
import { hiringErrorResponse, NO_STORE, requireHiringWriter } from "@/lib/hiring/route-helpers";

/**
 * PATCH — a role's "Hires become" only (board "Hiring", 2026-11-16): an
 * explicit account role, or null for "not chosen". Choosing it does not let
 * anyone hire into it: Mark hired applies its own rule on the server
 * (operations managers only into Cleaner and Laundry accounts). Audited.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { creator } = await requireHiringWriter();
    const body = (await req.json().catch(() => ({}))) as { hireAccountRole?: unknown };
    const next = body.hireAccountRole === null || body.hireAccountRole === "" ? null : body.hireAccountRole;
    if (next !== null && !isHireAccountKind(next)) {
      return NextResponse.json({ error: "Hires become must be Cleaner, Laundry, QA inspector, Maintenance or Ops manager accounts." }, { status: 400, headers: NO_STORE });
    }
    const position = await db.hiringPosition.findUnique({ where: { id: params.id }, select: { id: true, hireAccountRole: true } });
    if (!position) throw new HiringError(404, "Role not found.");
    await db.$transaction([
      db.hiringPosition.update({ where: { id: position.id }, data: { hireAccountRole: next as Role | null } }),
      db.auditLog.create({ data: { userId: creator.id, action: "HIRING_ROLE_HIRES_BECOME", entity: "HiringPosition", entityId: position.id, before: { hireAccountRole: position.hireAccountRole }, after: { hireAccountRole: next } } }),
    ]);
    return NextResponse.json({ ok: true, hireAccountRole: next }, { headers: NO_STORE });
  } catch (error) {
    return hiringErrorResponse(error, "Could not save Hires become.");
  }
}
