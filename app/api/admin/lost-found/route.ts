import { NextRequest, NextResponse } from "next/server";
import { Role, type Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { hydrateItems } from "@/lib/lost-found/service";
import { LOST_FOUND_STATUSES } from "@/lib/lost-found/status";

function errorStatus(err: any): number {
  if (err?.message === "UNAUTHORIZED") return 401;
  if (err?.message === "FORBIDDEN") return 403;
  return 400;
}

/**
 * GET — admin/ops board of all lost & found items.
 * Query: status, propertyId, from (ISO), to (ISO), q (item / location text).
 * Returns { items, openCount, properties } for the board + filters.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);

    const status = searchParams.get("status")?.trim();
    const propertyId = searchParams.get("propertyId")?.trim();
    const from = searchParams.get("from")?.trim();
    const to = searchParams.get("to")?.trim();
    const q = searchParams.get("q")?.trim();

    const where: Prisma.LostFoundItemWhereInput = {};
    if (status && (LOST_FOUND_STATUSES as readonly string[]).includes(status)) {
      where.status = status as any;
    }
    if (propertyId) where.propertyId = propertyId;

    const createdAt: Prisma.DateTimeFilter = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        createdAt.lte = d;
      }
    }
    if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

    if (q) {
      where.OR = [
        { itemName: { contains: q } },
        { foundLocation: { contains: q } },
        { guestName: { contains: q } },
        { description: { contains: q } },
      ];
    }

    const items = await db.lostFoundItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const rows = await hydrateItems(items);
    // Stable open badge: total unresolved items, independent of the active filter.
    const openCount = await db.lostFoundItem.count({
      where: { status: { notIn: ["RETURNED", "DISPOSED", "DONATED", "UNCLAIMED", "ARCHIVED"] as any } },
    });

    // Property options for the filter — only those that have items.
    const propertyMap = new Map<string, string>();
    for (const r of rows) {
      if (r.propertyId && r.propertyName) propertyMap.set(r.propertyId, r.propertyName);
    }
    const properties = Array.from(propertyMap, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return NextResponse.json({ items: rows, openCount, properties });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: errorStatus(err) });
  }
}
