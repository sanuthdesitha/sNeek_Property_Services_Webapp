import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  computeShoppingRunTotals,
  getShoppingRunByIdForAdmin,
  saveShoppingRunForOwner,
  type ShoppingRunRow,
} from "@/lib/inventory/shopping-runs";

const schema = z.object({
  budget: z.number().min(0).optional().nullable(),
  maxUnits: z.number().min(1).optional().nullable(),
  maxLines: z.number().min(1).optional().nullable(),
  apply: z.boolean().optional(),
});

function priorityWeight(value: ShoppingRunRow["priority"]) {
  if (value === "Emergency") return 3;
  if (value === "High") return 2;
  return 1;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const run = await getShoppingRunByIdForAdmin(params.id);
    if (!run) return NextResponse.json({ error: "Shopping run not found." }, { status: 404 });
    const body = schema.parse(await req.json().catch(() => ({})));
    const budget = body.budget == null ? null : Math.max(0, Number(body.budget));
    const maxUnits = body.maxUnits == null ? null : Math.max(1, Number(body.maxUnits));
    const maxLines = body.maxLines == null ? null : Math.max(1, Number(body.maxLines));

    const sorted = [...run.rows].sort((a, b) => {
      const byPriority = priorityWeight(b.priority) - priorityWeight(a.priority);
      if (byPriority !== 0) return byPriority;
      const aCost = a.estimatedUnitCost ?? 0;
      const bCost = b.estimatedUnitCost ?? 0;
      return aCost - bCost;
    });

    let usedBudget = 0;
    let usedUnits = 0;
    let usedLines = 0;
    const optimizedRows: ShoppingRunRow[] = sorted.map((row) => {
      const next = { ...row, include: false, plannedQty: 0 };
      const qty = Math.max(0, Number(row.plannedQty || row.needed || 0));
      if (qty <= 0) return next;
      const unitCost = Math.max(0, Number(row.estimatedUnitCost ?? 0));
      const lineCost = unitCost * qty;
      const overBudget = budget != null && usedBudget + lineCost > budget;
      const overUnits = maxUnits != null && usedUnits + qty > maxUnits;
      const overLines = maxLines != null && usedLines + 1 > maxLines;
      if (overBudget || overUnits || overLines) return next;
      next.include = true;
      next.plannedQty = qty;
      usedBudget += lineCost;
      usedUnits += qty;
      usedLines += 1;
      return next;
    });

    const reordered = run.rows.map((row) => optimizedRows.find((next) => next.itemId === row.itemId && next.propertyId === row.propertyId) ?? row);
    const totals = computeShoppingRunTotals(reordered);

    let saved = null;
    if (body.apply) {
      saved = await saveShoppingRunForOwner({
        id: run.id,
        name: run.name,
        status: run.status,
        ownerScope: run.ownerScope,
        ownerUserId: run.ownerUserId,
        clientId: run.clientId,
        planningScope: run.planningScope,
        rows: reordered,
      });
    }

    return NextResponse.json({
      runId: run.id,
      optimized: {
        budget,
        maxUnits,
        maxLines,
        usedBudget: Number(usedBudget.toFixed(2)),
        usedUnits,
        usedLines,
      },
      totals,
      rows: reordered,
      saved,
    });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not optimize shopping run." }, { status });
  }
}

