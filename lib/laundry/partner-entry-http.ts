import "server-only";
import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { PartnerEntryError, type PartnerEntryViewer } from "./partner-entries";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * Shared handler for the laundry partner portal write routes: live session and
 * role guard (LAUNDRY only), never while impersonating (the entry must come
 * from the real person), the service re-checks scope, partner and version.
 */
export async function handlePartnerEntry<T>(
  request: Request,
  run: (viewer: PartnerEntryViewer, body: unknown) => Promise<T>,
  failure: string,
): Promise<NextResponse> {
  try {
    const session = await requireRole([Role.LAUNDRY]);
    if (session.impersonation) {
      return NextResponse.json({ error: "This cannot be done while impersonating." }, { status: 403, headers });
    }
    const body: unknown = await request.json();
    const result = await run({ id: session.user.id, role: session.user.role }, body);
    return NextResponse.json(result, { headers });
  } catch (error: unknown) {
    if (error instanceof PartnerEntryError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Check the values and try again." }, { status: 400, headers });
    }
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Check the values and try again." }, { status: 400, headers });
    const status = getApiErrorStatus(error, 500);
    return NextResponse.json({ error: status === 500 ? failure : (error as Error).message }, { status, headers });
  }
}
