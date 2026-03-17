import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { applyReschedule } from "@/lib/phase4/analytics";

const schema = z.object({
  date: z.string().date(),
  startTime: z.string().trim().max(5).optional().nullable(),
  dueTime: z.string().trim().max(5).optional().nullable(),
  reason: z.string().trim().max(1200).optional().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const updated = await applyReschedule({
      jobId: params.jobId,
      date: body.date,
      startTime: body.startTime ?? undefined,
      dueTime: body.dueTime ?? undefined,
      reason: body.reason ?? null,
      userId: session.user.id,
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not apply reschedule." }, { status });
  }
}

