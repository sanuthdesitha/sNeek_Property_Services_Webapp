import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { assignQuizzesToApplication } from "@/lib/workforce/quiz";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    // Accept a single id (legacy) or an array of ids (combined send).
    const ids: string[] = Array.isArray(body.quizTemplateIds)
      ? body.quizTemplateIds.filter((v: unknown): v is string => typeof v === "string" && v.trim().length > 0)
      : typeof body.quizTemplateId === "string" && body.quizTemplateId
        ? [body.quizTemplateId]
        : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "Pick at least one quiz to assign." }, { status: 400 });
    }
    const assignment = await assignQuizzesToApplication({
      applicationId: params.id,
      quizTemplateIds: ids,
      actorId: session.user.id,
    });
    return NextResponse.json({ ok: true, assignmentId: assignment.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not assign quiz." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
