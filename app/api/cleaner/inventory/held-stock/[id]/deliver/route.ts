import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { accessiblePropertyWhereForCleaner } from "@/lib/inventory/cleaner-scope";
import { requireRole } from "@/lib/auth/session";
import { deliverHeldStock } from "@/lib/inventory/held-stock";
import { notifyHeldStockDelivery } from "@/lib/inventory/held-stock-delivery-notification";

const schema = z.object({
  propertyId: z.string().min(1),
  quantity: z.number().positive(),
  requestId: z.string().uuid().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

// A cleaner drops their own on-hand stock at a unit (ownership-guarded).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    if (session.impersonation?.mode === "READ_ONLY") throw new Error("FORBIDDEN");
    const body = schema.parse(await req.json());
    const destination = await db.property.findFirst({ where: { id: body.propertyId, ...(session.user.role === Role.CLEANER ? accessiblePropertyWhereForCleaner(session.user.id) : { isActive: true }) }, select: { id: true } });
    if (!destination) throw new Error("FORBIDDEN");
    const delivery = await deliverHeldStock({
      heldStockId: params.id,
      propertyId: body.propertyId,
      quantity: body.quantity,
      requestId: body.requestId,
      deliveredById: session.user.id,
      note: body.note ?? null,
      requireHolderUserId: session.user.id,
    });
    const notificationWarning = await notifyHeldStockDelivery(params.id, delivery.id);
    return NextResponse.json({ ok: true, deliveryId: delivery.id, notificationWarning });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
