import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ensureDefaultQuizTemplates, listQuizTemplates } from "@/lib/workforce/quiz";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await ensureDefaultQuizTemplates();
    const templates = await listQuizTemplates();
    return NextResponse.json(
      templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        questionCount: Array.isArray((t.schema as any)?.questions) ? (t.schema as any).questions.length : 0,
      })),
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load quizzes." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
