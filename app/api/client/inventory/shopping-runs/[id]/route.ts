import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { db } from "@/lib/db";
import { isClientModuleEnabled } from "@/lib/portal-access";
import {
  deleteShoppingRunForOwner,
  getShoppingRunForOwner,
  saveShoppingRunForOwner,
  type ShoppingRunRow,
  type ShoppingRunStatus,
} from "@/lib/inventory/shopping-runs";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: z.enum(["DRAFT", "IN_PROGRESS", "COMPLETED"]).optional(),
  planningScope: z.string().min(1).optional(),
  rows: z
    .array(
      z.object({
        propertyId: z.string().min(1),
        propertyName: z.string().min(1),
        suburb: z.string().optional().default(""),
        itemId: z.string().min(1),
        itemName: z.string().min(1),
        category: z.string().min(1),
        supplier: z.string().nullable().optional(),
        unit: z.string().min(1),
        onHand: z.number(),
        parLevel: z.number(),
        reorderThreshold: z.number(),
        needed: z.number().min(0),
        plannedQty: z.number().min(0),
        include: z.boolean(),
        purchased: z.boolean(),
        note: z.string().max(500).optional().nullable(),
        priority: z.enum(["Emergency", "High", "Medium"]).optional(),
        estimatedUnitCost: z.number().min(0).nullable().optional(),
        estimatedLineCost: z.number().min(0).nullable().optional(),
      })
    )
    .max(5000)
    .optional(),
});

async function getClientContext(userId: string) {
  const settings = await getAppSettings();
  if (!isClientModuleEnabled(settings, "shopping")) throw new Error("FORBIDDEN");
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { clientId: true },
  });
  return { clientId: user?.clientId ?? null };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const { clientId } = await getClientContext(session.user.id);
    const run = await getShoppingRunForOwner({
      id: params.id,
      ownerScope: "CLIENT",
      ownerUserId: session.user.id,
      clientId,
    });
    if (!run) return NextResponse.json({ error: "Run not found." }, { status: 404 });
    return NextResponse.json(run);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const { clientId } = await getClientContext(session.user.id);
    const existing = await getShoppingRunForOwner({
      id: params.id,
      ownerScope: "CLIENT",
      ownerUserId: session.user.id,
      clientId,
    });
    if (!existing) return NextResponse.json({ error: "Run not found." }, { status: 404 });
    const body = patchSchema.parse(await req.json());
    const rows: ShoppingRunRow[] = (body.rows ?? existing.rows).map((row) => ({
      ...row,
      suburb: row.suburb ?? "",
      supplier: row.supplier ?? null,
      note: row.note ?? undefined,
      estimatedUnitCost: row.estimatedUnitCost ?? null,
      estimatedLineCost: row.estimatedLineCost ?? null,
    }));
    const saved = await saveShoppingRunForOwner({
      id: existing.id,
      name: body.name?.trim() ?? existing.name,
      status: (body.status ?? existing.status) as ShoppingRunStatus,
      ownerScope: "CLIENT",
      ownerUserId: session.user.id,
      clientId,
      planningScope: body.planningScope ?? existing.planningScope,
      rows,
    });
    return NextResponse.json(saved);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Update failed." }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const { clientId } = await getClientContext(session.user.id);
    const ok = await deleteShoppingRunForOwner({
      id: params.id,
      ownerScope: "CLIENT",
      ownerUserId: session.user.id,
      clientId,
    });
    if (!ok) return NextResponse.json({ error: "Run not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Delete failed." }, { status });
  }
}
