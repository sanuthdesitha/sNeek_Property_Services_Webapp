import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { canActAs } from "@/lib/auth/roles";
import { ADMIN_ONLY_BULK_ACTIONS, accountBulkSchema, runAccountBulk } from "@/lib/accounts/bulk";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/users/bulk  { action, ids, hourlyRate? }
 * Answers one outcome per person. Disable and change-rate are ADMIN only (as
 * their single-person endpoints are); resend invite also admits OPS_MANAGER.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = accountBulkSchema.parse(await req.json().catch(() => null));
    const held = (session.user.heldRoles ?? [session.user.role]) as Role[];
    if (ADMIN_ONLY_BULK_ACTIONS.has(body.action) && !canActAs(held, [Role.ADMIN])) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    return NextResponse.json(await runAccountBulk(session.user.id, body));
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401 });
    if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403 });
    return NextResponse.json({ error: "Could not run the bulk action." }, { status: 500 });
  }
}
