import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ingestDriverBatch } from "@/lib/gps/ingest-service";

export const dynamic = "force-dynamic";

/**
 * The laundry driver tracker's batches (same envelope as the cleaner route).
 *
 * Only a LAUNDRY driver with an ACTIVE route dated today is recorded
 * (lib/gps/tracking-window). Office roles may still call it — the route is
 * shared with the driver portal pages they can open — but they are never a
 * location source: their fixes are dropped as outside the window. Fixes are
 * filed against the job behind the route's next stop, tagged with the route.
 * A precise live fix within the arrival radius of the next stop stamps its
 * arrival and the response carries `arrivedStop`.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "FORBIDDEN";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const outcome = await ingestDriverBatch({
    userId: session.user.id,
    role: session.user.role,
    impersonating: Boolean(session.impersonation),
    body,
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
