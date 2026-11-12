import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { isListQueryError } from "@/lib/admin/list-query";
import { listAccountEmails } from "@/lib/people/account-emails/service";
import { parseAccountEmailListFilters, parseAccountEmailListQuery } from "@/lib/people/account-emails/types";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

/**
 * GET /api/admin/users/account-emails — People › Invitations: one row per
 * person with their most recent account email (type, sent, sender, recorded
 * delivery, invitation expiry, signed in), server filtered, sorted and paged.
 * ADMIN and OPS_MANAGER read (accounts pack via the middleware); each row says
 * whether THIS viewer may resend or copy the link, by the same rules as the
 * person panel (ADMIN, or OPS_MANAGER with the accounts pack at manage; never
 * upward; never while impersonating). Sending goes through the existing
 * per-person and bulk routes, which re-check everything.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const filters = parseAccountEmailListFilters(params);
    const query = parseAccountEmailListQuery(params);
    return NextResponse.json(await listAccountEmails(session, filters, query), { headers });
  } catch (error) {
    if (isListQueryError(error)) return NextResponse.json({ error: error.message }, { status: 400, headers });
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401, headers });
    if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403, headers });
    return NextResponse.json({ error: "Could not load account emails." }, { status: 500, headers });
  }
}
