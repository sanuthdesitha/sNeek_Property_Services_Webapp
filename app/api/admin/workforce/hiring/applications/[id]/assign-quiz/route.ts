import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { assignQuizToApplication } from "@/lib/workforce/quiz";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const quizTemplateId = typeof body.quizTemplateId === "string" ? body.quizTemplateId : "";
    if (!quizTemplateId) {
      return NextResponse.json({ error: "Pick a quiz to assign." }, { status: 400 });
    }
    const assignment = await assignQuizToApplication({
      applicationId: params.id,
      quizTemplateId,
      actorId: session.user.id,
    });
    return NextResponse.json({ ok: true, assignmentId: assignment.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not assign quiz." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
