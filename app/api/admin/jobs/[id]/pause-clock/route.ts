import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { OfficeSendDenied, requireOfficeSend } from "@/lib/notifications/office-send-permission";
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
 * cleaner's running clock on this job (Live ops). ADMIN, or OPS_MANAGER with
 * the Jobs pack at manage (owner decision 2026-11-12). Refused while
 * impersonating (the pause must be recorded against the real person).
 * See lib/jobs/admin-clock-pause.ts for exactly what it changes.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { actor } = await requireOfficeSend("clock_pause");
    const body = bodySchema.parse(await request.json());
    const result = await pauseCleanerClockByOffice({
      jobId: params.id,
      cleanerId: body.cleanerId,
      reason: body.reason,
      transports: body.transports,
      actorId: actor.id,
      actorRole: actor.role,
    });
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof OfficeSendDenied) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ClockPauseError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check the cleaner, reason and transport." }, { status: 400, headers });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Check the cleaner, reason and transport." }, { status: 400, headers });
    const status = getApiErrorStatus(error, 500);
    return NextResponse.json({ error: status === 500 ? "The clock could not be paused." : (error as Error).message }, { status, headers });
  }
}
