import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z, ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getApiErrorStatus } from "@/lib/api/http";
import { ClockPauseError, pauseCleanerClockByOffice } from "@/lib/jobs/admin-clock-pause";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

const bodySchema = z.object({
  cleanerId: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(3, "Give a reason for pausing the clock.").max(500),
  transports: z.array(z.enum(["PUSH", "EMAIL"])).min(1).max(2),
}).strict();

/**
 * POST /api/admin/jobs/[id]/pause-clock — an administrator pauses one
 * cleaner's running clock on this job (Live ops). ADMIN only: operations
 * managers are refused until the owner decides otherwise. Refused while
 * impersonating (the pause must be recorded against the real person).
 * See lib/jobs/admin-clock-pause.ts for exactly what it changes.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    if (session.impersonation) return NextResponse.json({ error: "A clock cannot be paused while impersonating." }, { status: 403, headers });
    const body = bodySchema.parse(await request.json());
    const result = await pauseCleanerClockByOffice({
      jobId: params.id,
      cleanerId: body.cleanerId,
      reason: body.reason,
      transports: body.transports,
      actorId: session.user.id,
    });
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof ClockPauseError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check the cleaner, reason and transport." }, { status: 400, headers });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Check the cleaner, reason and transport." }, { status: 400, headers });
    const status = getApiErrorStatus(error, 500);
    return NextResponse.json({ error: status === 500 ? "The clock could not be paused." : (error as Error).message }, { status, headers });
  }
}
