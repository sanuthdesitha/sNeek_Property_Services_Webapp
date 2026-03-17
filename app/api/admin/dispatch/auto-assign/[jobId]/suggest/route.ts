import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { suggestAutoAssignment } from "@/lib/ops/dispatch";

export async function GET(
  _req: Request,
  { params }: { params: { jobId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const suggestions = await suggestAutoAssignment(params.jobId);
    return NextResponse.json({ suggestions });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not generate suggestions." }, { status });
  }
}

