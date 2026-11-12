import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ingestCleanerBatch } from "@/lib/gps/ingest-service";

export const dynamic = "force-dynamic";

/**
 * The cleaner tracker's batches: `{ sentAt, pings: [{ clientId, jobId, lat,
 * lng, accuracy, heading, speed, timestamp }], state? }` (a bare fix or array
 * from older clients is still accepted). Everything — impersonation refusal,
 * the tracking window, clock-skew correction, idempotent storage, the latest
 * position and arrival/departure — lives in lib/gps/ingest-service.
 *
 * Refused fixes are answered 200 with counted reasons: the client clears what
 * the server can never accept instead of retrying it forever, and re-asks
 * whether it should still be tracking when `window.active` is false.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireRole([Role.CLEANER]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "FORBIDDEN";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized" : "Forbidden" }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const outcome = await ingestCleanerBatch({
    userId: session.user.id,
    impersonating: Boolean(session.impersonation),
    body,
  });
  return NextResponse.json(outcome.body, { status: outcome.status });
}
