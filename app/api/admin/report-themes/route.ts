import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const themes = await (db as any).reportTheme.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: "desc" }, { kind: "asc" }, { name: "asc" }],
      select: {
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
      },
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
    const body = await req.json();
    const theme = await (db as any).reportTheme.create({
      data: {
        name: String(body.name ?? "Untitled theme"),
        kind: body.kind ?? "CUSTOM",
        isDefault: false,
        isActive: true,
        layout: body.layout ?? {
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
        },
        logoUrl: body.logoUrl ?? null,
        primaryColorHsl: body.primaryColorHsl ?? null,
        accentColorHsl: body.accentColorHsl ?? null,
        titleTemplate: body.titleTemplate ?? "Job Report — {{job.jobNumber}}",
        footerHtml: body.footerHtml ?? null,
        createdById: (session as any)?.user?.id ?? null,
      },
    });
    return NextResponse.json({ theme });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
