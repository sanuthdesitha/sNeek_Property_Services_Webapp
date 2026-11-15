import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ThemeInputError, themeDataFromBody } from "@/lib/reports/theme-input";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const theme = await db.reportTheme.findUnique({ where: { id: params.id } });
    if (!theme) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ theme });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

/**
 * Save a theme. Changes future reports only. With `expectedUpdatedAt` a theme
 * someone else saved since answers 409 with theirs (stale-write guard). The
 * default theme cannot be switched off.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const data = themeDataFromBody(body);
    const expected = typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null;
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ReportTheme" WHERE "id" = ${params.id} FOR UPDATE`;
      const current = await tx.reportTheme.findUnique({ where: { id: params.id } });
      if (!current) return { status: 404 as const };
      if (expected && current.updatedAt.getTime() !== expected.getTime()) return { status: 409 as const, current };
      if (data.isActive === false && current.isDefault) return { status: 400 as const };
      const theme = await tx.reportTheme.update({ where: { id: params.id }, data: data as any });
      return { status: 200 as const, theme };
    });
    if (result.status === 404) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (result.status === 400) return NextResponse.json({ error: "The default theme cannot be switched off. Make another theme the default first." }, { status: 400 });
    if (result.status === 409) return NextResponse.json({ error: "Someone else saved this theme after you opened it. Your changes are kept; load theirs to continue.", current: result.current }, { status: 409 });
    return NextResponse.json({ theme: result.theme });
  } catch (err: any) {
    if (err instanceof ThemeInputError) return NextResponse.json({ error: err.message }, { status: 400 });
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

/** "Switch off": a soft delete, so reports made with the theme keep it. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    // Soft-deactivate to avoid breaking past report.themeId references
    const existing = await db.reportTheme.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.isDefault) {
      return NextResponse.json({ error: "Cannot delete default theme" }, { status: 400 });
    }
    await db.reportTheme.update({ where: { id: params.id }, data: { isActive: false } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
