import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ThemeInputError, themeDataFromBody } from "@/lib/reports/theme-input";
import { ESTATE_REPORT_COLOURS } from "@/lib/reports/theme-rules";

const SELECT = {
  id: true,
  name: true,
  kind: true,
  isDefault: true,
  isActive: true,
  layout: true,
  logoUrl: true,
  primaryColorHsl: true,
  accentColorHsl: true,
  titleTemplate: true,
  footerHtml: true,
  updatedAt: true,
} as const;

/**
 * Report themes. Active ones by default (the regenerate picker reads this);
 * `?all=1` adds switched-off themes and how many reports were made with each
 * (the Report themes page). ADMIN and OPS_MANAGER (reports pack: View reads,
 * Manage writes).
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const all = req.nextUrl.searchParams.get("all") === "1";
    const themes = await db.reportTheme.findMany({
      where: all ? {} : { isActive: true },
      orderBy: [{ isDefault: "desc" }, { kind: "asc" }, { name: "asc" }],
      select: all ? { ...SELECT, _count: { select: { reports: true } } } : SELECT,
    });
    return NextResponse.json({ themes });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const data = themeDataFromBody({ name: "Untitled theme", ...body });
    const theme = await db.reportTheme.create({
      data: {
        name: data.name ?? "Untitled theme",
        kind: (typeof body.kind === "string" ? body.kind : "CUSTOM") as any,
        isDefault: false,
        isActive: true,
        layout: (data.layout ?? {
          sections: [
            { id: "header", visible: true, order: 0 },
            { id: "summary", visible: true, order: 1 },
            { id: "task-checklist", visible: true, order: 2 },
            { id: "before-after-gallery", visible: true, order: 3, options: { columns: 2 } },
            { id: "supplies", visible: false, order: 4 },
            { id: "signature", visible: true, order: 5 },
            { id: "footer", visible: true, order: 6 },
          ],
          photoSize: "medium",
          density: "default",
        }) as any,
        logoUrl: data.logoUrl ?? null,
        // New themes start from the Estate colours (the same start as Email look), stored on the theme.
        primaryColorHsl: data.primaryColorHsl === undefined ? ESTATE_REPORT_COLOURS.primary.hsl : data.primaryColorHsl,
        accentColorHsl: data.accentColorHsl === undefined ? ESTATE_REPORT_COLOURS.accent.hsl : data.accentColorHsl,
        titleTemplate: data.titleTemplate === undefined ? "Job Report — {{job.jobNumber}}" : data.titleTemplate,
        footerHtml: data.footerHtml ?? null,
        createdById: session.user.id ?? null,
      },
    });
    return NextResponse.json({ theme });
  } catch (err: any) {
    if (err instanceof ThemeInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
