import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { deliverHeldStock } from "@/lib/inventory/held-stock";

const schema = z.object({
  propertyId: z.string().min(1),
  quantity: z.number().positive(),
  note: z.string().trim().max(2000).nullable().optional(),
});

// Drop a quantity of on-hand stock at a unit → bumps the unit's real count.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());
    const delivery = await deliverHeldStock({
      heldStockId: params.id,
      propertyId: body.propertyId,
      quantity: body.quantity,
      deliveredById: session.user.id,
      note: body.note ?? null,
    });
    return NextResponse.json({ ok: true, deliveryId: delivery.id });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
