import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { renderReportThemePreview } from "@/lib/reports/generator";
import { normalizeThemeLayout } from "@/lib/reports/theme-rules";
import { ThemeInputError, themeDataFromBody } from "@/lib/reports/theme-input";

const bodySchema = z.object({ jobId: z.string().trim().min(1).max(64), theme: z.record(z.string(), z.unknown()) });

/**
 * POST — the report for one job drawn with the editor's UNSAVED theme, by the
 * same generator that makes the PDF. Read only: nothing is saved, uploaded,
 * rendered to PDF or sent. A POST only because the draft theme is the body;
 * operations managers need the reports pack at Manage, like the editor.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const data = themeDataFromBody(body.theme);
    const html = await renderReportThemePreview(body.jobId, {
      id: typeof body.theme.id === "string" ? body.theme.id : "preview",
      name: data.name ?? "Preview",
      kind: typeof body.theme.kind === "string" ? body.theme.kind : "CUSTOM",
      isDefault: false,
      layout: normalizeThemeLayout(data.layout ?? body.theme.layout),
      logoUrl: data.logoUrl ?? null,
      primaryColorHsl: data.primaryColorHsl ?? null,
      accentColorHsl: data.accentColorHsl ?? null,
      titleTemplate: data.titleTemplate ?? null,
      footerHtml: data.footerHtml ?? null,
    });
    if (html === null) return NextResponse.json({ error: "That job no longer exists. Choose another job." }, { status: 404 });
    return NextResponse.json({ html });
  } catch (err: any) {
    if (err instanceof ThemeInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof z.ZodError) return NextResponse.json({ error: "Choose a job for the preview." }, { status: 400 });
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "The preview could not be made for this job." : err.message }, { status });
  }
}
