import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { suggestReschedulePlan } from "@/lib/phase4/analytics";

const querySchema = z.object({
  daysAhead: z.coerce.number().int().min(1).max(30).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const query = querySchema.parse({
      daysAhead: searchParams.get("daysAhead") ?? undefined,
    });
    const plan = await suggestReschedulePlan(params.jobId, query);
    return NextResponse.json(plan);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not suggest reschedule plan." }, { status });
  }
}

