import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createQuizTemplateFromScreening } from "@/lib/workforce/quiz";

/**
 * Save a position's knowledge test as a reusable quiz template, so it can be
 * assigned/emailed to candidates on other applications. Accepts the editor's
 * current state (title/intro/passThreshold/questions) so it captures exactly
 * what's on screen; falls back to the position's stored screening schema.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));

    const position = await db.hiringPosition.findUnique({
      where: { id: params.id },
      select: { id: true, title: true },
    });
    if (!position) return NextResponse.json({ error: "Position not found." }, { status: 404 });

    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : typeof body.title === "string" && body.title.trim()
          ? body.title.trim()
          : `${position.title} — Knowledge test`;

    const template = await createQuizTemplateFromScreening({
      name,
      description: `Knowledge test saved from "${position.title}".`,
      requireKnowledgeTest: true,
      passThreshold: typeof body.passThreshold === "number" ? body.passThreshold : null,
      questions: Array.isArray(body.questions) ? body.questions : null,
      title: typeof body.title === "string" ? body.title : null,
      intro: typeof body.intro === "string" ? body.intro : null,
    });

    return NextResponse.json({ ok: true, id: template.id, name: template.name });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not save as quiz." }, { status });
  }
}
