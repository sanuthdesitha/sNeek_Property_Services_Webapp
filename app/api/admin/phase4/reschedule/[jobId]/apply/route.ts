import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { applyRescheduleWithNotice } from "@/lib/phase4/analytics";

const schema = z.object({
  date: z.string().date(),
  startTime: z.string().trim().max(5).optional().nullable(),
  dueTime: z.string().trim().max(5).optional().nullable(),
  endTime: z.string().trim().max(5).optional().nullable(),
  expectedUpdatedAt: z.string().datetime().optional(),
  reason: z.string().trim().max(1200).optional().nullable(),
  /** The person's explicit "Tell the client?" answer; omitted keeps the automatic email. */
  notifyClient: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const { job: updated, clientNotice } = await applyRescheduleWithNotice({
      jobId: params.jobId,
      date: body.date,
      startTime: body.startTime,
      dueTime: body.dueTime,
      endTime: body.endTime,
      reason: body.reason ?? null,
      userId: session.user.id,
      expectedUpdatedAt: body.expectedUpdatedAt,
      notifyClient: body.notifyClient,
    });
    // The job as before, plus what happened to the client's schedule email.
    return NextResponse.json({ ...updated, clientNotice });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not apply reschedule." }, { status });
  }
}

