import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { verifySensitiveAction } from "@/lib/security/admin-verification";
import { clientBulkSchema } from "@/lib/people/clients/bulk-types";
import { runClientBulk } from "@/lib/people/clients/bulk";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/clients/bulk { action, ids, subject?, message?, security? }
 * People › Clients bulk bar. ADMIN and OPS_MANAGER (clients pack, enforced by
 * the middleware on /api/admin/clients), as each single-client route allows.
 * "Mark inactive" needs the PIN or password and the `clients.delete` grant,
 * exactly like Delete client. One outcome per client; a refused client is
 * never reported as done.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = clientBulkSchema.parse(await req.json().catch(() => null));
    if (body.action === "mark-inactive") {
      await verifySensitiveAction(session.user.id, body.security, "clients.delete");
    }
    return NextResponse.json(await runClientBulk(session.user.id, body));
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401 });
    if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403 });
    if (message === "PIN_OR_PASSWORD_REQUIRED") return NextResponse.json({ error: "Enter your PIN or password." }, { status: 400 });
    if (message === "INVALID_SECURITY_VERIFICATION") return NextResponse.json({ error: "That PIN or password is not right." }, { status: 403 });
    return NextResponse.json({ error: "Could not run the bulk action." }, { status: 500 });
  }
}
