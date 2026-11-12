import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { TeamReplyError, recordTeamRequestReply } from "@/lib/laundry/team-request-replies";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/**
 * POST /api/laundry/office-requests/[requestId]/reply — a laundry team member
 * answers an office request with a typed reply (confirmed / can't / back by a
 * day and time / message). LAUNDRY accounts only, never while impersonating
 * (the answer must come from the real person). Idempotent per key.
 */
export async function POST(request: Request, { params }: { params: { requestId: string } }) {
  try {
    const session = await requireRole([Role.LAUNDRY]);
    if (session.impersonation) return NextResponse.json({ error: "Answers cannot be given while impersonating." }, { status: 403, headers });
    const result = await recordTeamRequestReply({ id: session.user.id, role: session.user.role, name: session.user.name }, params.requestId, await request.json());
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers });
  } catch (error: unknown) {
    if (error instanceof TeamReplyError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Check the answer, the time and the day." }, { status: 400, headers });
    const status = getApiErrorStatus(error, 500);
    return NextResponse.json({ error: status === 500 ? "The answer could not be saved." : (error as Error).message }, { status, headers });
  }
}
