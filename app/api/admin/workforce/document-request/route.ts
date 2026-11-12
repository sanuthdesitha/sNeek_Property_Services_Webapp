import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { loadDocumentRequestOptions } from "@/lib/workforce/document-request-options";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * GET ?userId= — what Accounts "Request document" can send to this person:
 * each transport (Inbox, Email, SMS) with whether it can be used and why not
 * (no contact, switched off in Notifications, provider not configured), and
 * the signed-in office user's own saved "Don't ask again" choice. Read-only;
 * the send is POST /api/admin/workforce { action: "REQUEST_DOCUMENT" }. Same
 * roles as that route (the middleware applies the workforce pack).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const userId = req.nextUrl.searchParams.get("userId")?.trim() ?? "";
    if (!userId || userId.length > 200) return NextResponse.json({ error: "userId is required." }, { status: 400, headers });
    const options = await loadDocumentRequestOptions(userId, { id: session.user.id, impersonating: Boolean(session.impersonation) });
    if (!options) return NextResponse.json({ error: "Person not found." }, { status: 404, headers });
    return NextResponse.json(options, { headers });
  } catch (err: unknown) {
    const status = getApiErrorStatus(err, 500);
    return NextResponse.json({ error: status === 500 ? "Could not load the sending options." : (err as Error).message }, { status, headers });
  }
}
