import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { LOCATION_NOTICE_VERSION, type NoticePortal } from "@/lib/gps/notice";
import { acknowledgeLocationNotice, hasAcknowledgedLocationNotice } from "@/lib/gps/notice-server";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function portalFor(role: Role): NoticePortal | null {
  return role === Role.CLEANER ? "CLEANER" : role === Role.LAUNDRY ? "LAUNDRY" : null;
}

/**
 * The live-location notice acknowledgement for the signed-in cleaner or
 * laundry driver. GET: has the current version been accepted? POST: accept it.
 * Only the person themself can accept: refused while an administrator is
 * viewing as them.
 */
export async function GET() {
  try {
    const session = await requireRole([Role.CLEANER, Role.LAUNDRY]);
    const portal = portalFor(session.user.role);
    if (!portal) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    const acknowledged = await hasAcknowledgedLocationNotice(session.user.id, portal);
    return NextResponse.json({ portal, version: LOCATION_NOTICE_VERSION, acknowledged }, { headers: privateHeaders });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not read the notice status." : err.message }, { status, headers: privateHeaders });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER, Role.LAUNDRY]);
    if (session.impersonation) {
      return NextResponse.json({ error: "IMPERSONATING", message: "Only the person themself can accept the location notice." }, { status: 403 });
    }
    const portal = portalFor(session.user.role);
    if (!portal) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    const body = (await req.json().catch(() => ({}))) as { version?: unknown };
    if (body.version !== LOCATION_NOTICE_VERSION) {
      return NextResponse.json({ error: "NOTICE_VERSION_CHANGED", version: LOCATION_NOTICE_VERSION, message: "The notice has changed. Read it again." }, { status: 409 });
    }
    const result = await acknowledgeLocationNotice(session.user.id, portal, req.headers.get("user-agent"));
    return NextResponse.json({ ok: true, portal, version: LOCATION_NOTICE_VERSION, acknowledgedAt: result.acknowledgedAt.toISOString() }, { headers: privateHeaders });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not record the acknowledgement." : err.message }, { status, headers: privateHeaders });
  }
}
