import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const theme = await (db as any).reportTheme.findUnique({ where: { id: params.id } });
    if (!theme) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ theme });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json();
    const data: any = {};
    if (typeof body.name === "string") data.name = body.name;
    if (body.layout && typeof body.layout === "object") data.layout = body.layout;
    if (body.logoUrl !== undefined) data.logoUrl = body.logoUrl || null;
    if (body.primaryColorHsl !== undefined) data.primaryColorHsl = body.primaryColorHsl || null;
    if (body.accentColorHsl !== undefined) data.accentColorHsl = body.accentColorHsl || null;
    if (body.titleTemplate !== undefined) data.titleTemplate = body.titleTemplate || null;
    if (body.footerHtml !== undefined) data.footerHtml = body.footerHtml || null;
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;
    const theme = await (db as any).reportTheme.update({ where: { id: params.id }, data });
    return NextResponse.json({ theme });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    // Soft-deactivate to avoid breaking past report.themeId references
    const existing = await (db as any).reportTheme.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.isDefault) {
      return NextResponse.json({ error: "Cannot delete default theme" }, { status: 400 });
    }
    await (db as any).reportTheme.update({ where: { id: params.id }, data: { isActive: false } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
