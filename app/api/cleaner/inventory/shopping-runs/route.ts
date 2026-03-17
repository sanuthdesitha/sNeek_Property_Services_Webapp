import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import {
  listShoppingRunsForOwner,
  saveShoppingRunForOwner,
  type ShoppingRunRow,
  type ShoppingRunStatus,
} from "@/lib/inventory/shopping-runs";

const rowSchema = z.object({
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
});

const saveSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  status: z.enum(["DRAFT", "IN_PROGRESS", "COMPLETED"]),
  planningScope: z.string().min(1),
  rows: z.array(rowSchema).max(5000),
});

export async function GET() {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    if (session.user.role === Role.CLEANER) {
      const settings = await getAppSettings();
      if (!isCleanerModuleEnabled(settings, "shopping")) {
        return NextResponse.json({ error: "Shopping is not available for cleaners." }, { status: 403 });
      }
    }
    const runs = await listShoppingRunsForOwner({
      ownerScope: "CLEANER",
      ownerUserId: session.user.id,
    });
    return NextResponse.json(runs);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    if (session.user.role === Role.CLEANER) {
      const settings = await getAppSettings();
      if (!isCleanerModuleEnabled(settings, "shopping")) {
        return NextResponse.json({ error: "Shopping is not available for cleaners." }, { status: 403 });
      }
    }
    const body = saveSchema.parse(await req.json());
    const rows: ShoppingRunRow[] = body.rows.map((row) => ({
      ...row,
      suburb: row.suburb ?? "",
      supplier: row.supplier ?? null,
      note: row.note ?? undefined,
      estimatedUnitCost: row.estimatedUnitCost ?? null,
      estimatedLineCost: row.estimatedLineCost ?? null,
    }));
    const saved = await saveShoppingRunForOwner({
      id: body.id,
      name: body.name.trim(),
      status: body.status as ShoppingRunStatus,
      ownerScope: "CLEANER",
      ownerUserId: session.user.id,
      planningScope: body.planningScope,
      rows,
    });
    return NextResponse.json(saved, { status: body.id ? 200 : 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Save failed." }, { status });
  }
}
