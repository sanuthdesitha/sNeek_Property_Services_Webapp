import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { duplicateQaTemplate, QaTemplateNotFoundError } from "@/lib/qa/template-admin";

/** Duplicate a QA template (ADMIN). The copy is inactive until switched on. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN]);
    return NextResponse.json(await duplicateQaTemplate(params.id, session.user.id), { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    const status = err instanceof QaTemplateNotFoundError ? 404 : message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
