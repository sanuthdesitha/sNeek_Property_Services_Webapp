import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { rejectSurvey } from "@/lib/onboarding/approval/workflow";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    if (!body.reason?.trim()) return NextResponse.json({ error: "Rejection reason is required." }, { status: 400 });

    await rejectSurvey(params.id, session.user.id, body.reason.trim());
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
