import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { estimateInputSchema } from "@/lib/validations/onboarding";
import { calculateEstimation } from "@/lib/onboarding/estimation/calculator";

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = estimateInputSchema.parse(await req.json());
    const result = calculateEstimation(body);
    return NextResponse.json(result);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
