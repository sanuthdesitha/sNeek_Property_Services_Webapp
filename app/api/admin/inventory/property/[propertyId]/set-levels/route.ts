import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { z } from "zod";
import { Role } from "@prisma/client";

const schema = z.object({
  levels: z.array(
    z.object({
      itemId: z.string().cuid(),
      onHand: z.number().min(0),
      parLevel: z.number().min(0),
      reorderThreshold: z.number().min(0),
    })
  ),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { propertyId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { levels } = schema.parse(await req.json());

    for (const l of levels) {
      await db.propertyStock.upsert({
        where: {
          propertyId_itemId: { propertyId: params.propertyId, itemId: l.itemId },
        },
        create: {
          propertyId: params.propertyId,
          itemId: l.itemId,
          onHand: l.onHand,
          parLevel: l.parLevel,
          reorderThreshold: l.reorderThreshold,
        },
        update: {
          onHand: l.onHand,
          parLevel: l.parLevel,
          reorderThreshold: l.reorderThreshold,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
