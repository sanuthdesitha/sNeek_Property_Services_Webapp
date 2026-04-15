import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { getRelevantQuestions } from "@/lib/onboarding/questions/engine";

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const currentAnswers: Record<string, unknown> = body.answers ?? {};
    const completedQuestionIds: string[] = body.completedQuestionIds ?? [];

    const questions = getRelevantQuestions(currentAnswers, completedQuestionIds);
    return NextResponse.json(questions);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
