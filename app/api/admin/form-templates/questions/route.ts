import { NextRequest, NextResponse } from "next/server";
import { FormTemplateVersionKind, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildQuestionIndex } from "@/lib/forms/template-questions";
import { BULK_MAX_FORMS } from "@/lib/forms/template-bulk-types";

/**
 * GET /api/admin/form-templates/questions?ids=a,b,c — the questions present in
 * the selected forms (their working copy: the draft when there is one, else
 * the live schema), for the bulk "Edit a question in all selected forms"
 * picker. Each entry says in how many of the forms it appears exactly once.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const ids = Array.from(new Set((req.nextUrl.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean)));
    if (ids.length === 0) return NextResponse.json({ error: "Choose at least one form." }, { status: 400 });
    if (ids.length > BULK_MAX_FORMS) {
      return NextResponse.json({ error: `Choose at most ${BULK_MAX_FORMS} forms at a time.` }, { status: 400 });
    }
    const [templates, drafts] = await Promise.all([
      db.formTemplate.findMany({ where: { id: { in: ids } }, select: { id: true, schema: true } }),
      db.formTemplateVersion.findMany({
        where: { templateId: { in: ids }, kind: FormTemplateVersionKind.DRAFT },
        select: { templateId: true, schema: true },
      }),
    ]);
    const draftSchema = new Map(drafts.map((d) => [d.templateId, d.schema]));
    const schemas = templates.map((t) => draftSchema.get(t.id) ?? t.schema);
    return NextResponse.json({ formCount: templates.length, questions: buildQuestionIndex(schemas) });
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not read questions.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
