import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getVisibleLaundryPropertyIds } from "@/lib/laundry/teams";
const json = (body: unknown, init: ResponseInit = {}) => NextResponse.json(body, { ...init, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.LAUNDRY, Role.ADMIN, Role.OPS_MANAGER]);
    const resolved = req.nextUrl.searchParams.get("resolved") === "true";
    const where = { resolvedAt: resolved ? { not: null } : null, ...(session.user.role === Role.LAUNDRY ? { propertyId: { in: await getVisibleLaundryPropertyIds(session.user.id) } } : {}) };
    const cursor = req.nextUrl.searchParams.get("cursor");
    const [rows, total] = await db.$transaction([db.laundryQuantityException.findMany({ where, take: 26, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }), db.laundryQuantityException.count({ where })]);
    const shown = rows.slice(0, 25); const properties = await db.property.findMany({ where: { id: { in: shown.map(row => row.propertyId) } }, select: { id: true, name: true } });
    return json({ rows: shown.map(row => ({ ...row, propertyName: properties.find(property => property.id === row.propertyId)?.name ?? "Property no longer available" })), total, nextCursor: rows.length > 25 ? shown[shown.length - 1].id : null, canResolve: session.user.role !== Role.LAUNDRY });
  } catch (error: any) { return json({ error: "Quantity exceptions could not be loaded." }, { status: error.message === "UNAUTHORIZED" ? 401 : error.message === "FORBIDDEN" ? 403 : 503 }); }
}
const resolution = z.object({ id: z.string().min(1), version: z.number().int().nonnegative(), note: z.string().trim().min(3).max(2000) });
export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation) return json({ error: "Exceptions cannot be resolved while impersonating." }, { status: 403 });
    const body = resolution.parse(await req.json());
    const result = await db.$transaction(async tx => {
      const changed = await tx.laundryQuantityException.updateMany({ where: { id: body.id, version: body.version, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: session.user.id, resolutionNote: body.note, version: { increment: 1 } } });
      if (!changed.count) return null;
      await tx.auditLog.create({ data: { userId: session.user.id, action: "LAUNDRY_QUANTITY_EXCEPTION_RESOLVED", entity: "LaundryQuantityException", entityId: body.id, after: { resolutionNote: body.note } } });
      return tx.laundryQuantityException.findUnique({ where: { id: body.id } });
    });
    return result ? json(result) : json({ error: "Exception changed. Refresh before resolving." }, { status: 409 });
  } catch (error: any) { return json({ error: error.message === "FORBIDDEN" ? "Only the office can resolve exceptions." : "Resolution could not be confirmed. Refresh before trying again." }, { status: error.message === "UNAUTHORIZED" ? 401 : error.message === "FORBIDDEN" ? 403 : 400 }); }
}
