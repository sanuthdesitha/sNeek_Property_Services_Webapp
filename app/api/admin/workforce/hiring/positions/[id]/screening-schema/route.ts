import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { updatePositionScreeningSchema } from "@/lib/workforce/service";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const position = await updatePositionScreeningSchema(params.id, {
      requireKnowledgeTest: body.requireKnowledgeTest !== false,
      passThreshold: typeof body.passThreshold === "number" ? body.passThreshold : null,
      questions: Array.isArray(body.questions) ? body.questions : null,
      title: typeof body.title === "string" ? body.title : null,
      intro: typeof body.intro === "string" ? body.intro : null,
    });
    return NextResponse.json({ ok: true, position });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not save knowledge test." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
