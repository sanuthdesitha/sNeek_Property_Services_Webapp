import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { applyRestock } from "@/lib/inventory/stock";

export const dynamic = "force-dynamic";

/** Properties this cleaner can restock — ones they have (or had) a job at. */
async function accessibleProperties(userId: string) {
  const jobs = await db.job.findMany({
    where: {
      assignments: { some: { userId, removedAt: null } },
      property: { inventoryEnabled: true },
    },
    select: { property: { select: { id: true, name: true, suburb: true } } },
    distinct: ["propertyId"],
    orderBy: { property: { name: "asc" } },
  });
  const seen = new Set<string>();
  const properties: Array<{ id: string; name: string; suburb: string | null }> = [];
  for (const j of jobs) {
    if (j.property && !seen.has(j.property.id)) {
      seen.add(j.property.id);
      properties.push(j.property);
    }
  }
  return properties;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    const propertyId = new URL(req.url).searchParams.get("propertyId");
    const properties = await accessibleProperties(session.user.id);

    if (!propertyId) return NextResponse.json({ properties, items: [] });

    if (!properties.some((p) => p.id === propertyId)) {
      return NextResponse.json({ error: "No access to this property." }, { status: 403 });
    }

    const stock = await db.propertyStock.findMany({
      where: { propertyId, item: { isActive: true } },
      include: { item: { select: { id: true, name: true, category: true, unit: true } } },
      orderBy: [{ item: { category: "asc" } }, { item: { name: "asc" } }],
    });
    const items = stock.map((s) => ({
      propertyStockId: s.id,
      name: s.item?.name ?? "Item",
      category: s.item?.category ?? null,
      unit: s.item?.unit ?? null,
      onHand: s.onHand,
      parLevel: s.parLevel,
      reorderThreshold: s.reorderThreshold,
    }));
    return NextResponse.json({ properties, items });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

const postSchema = z.object({
  propertyId: z.string().min(1),
  lines: z
    .array(z.object({ propertyStockId: z.string().min(1), addQty: z.number().positive() }))
    .min(1),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    const body = postSchema.parse(await req.json());
    const properties = await accessibleProperties(session.user.id);
    if (!properties.some((p) => p.id === body.propertyId)) {
      return NextResponse.json({ error: "No access to this property." }, { status: 403 });
    }
    // Only touch stock rows that actually belong to this property (defence in depth).
    const owned = await db.propertyStock.findMany({
      where: { propertyId: body.propertyId, id: { in: body.lines.map((l) => l.propertyStockId) } },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((o) => o.id));
    const lines = body.lines.filter((l) => ownedIds.has(l.propertyStockId));
    if (lines.length === 0) return NextResponse.json({ error: "No valid stock lines." }, { status: 400 });

    const byLabel = session.user.name || session.user.email || "cleaner";
    const updated = await applyRestock(lines, byLabel);
    return NextResponse.json({ updated, count: updated.length });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
