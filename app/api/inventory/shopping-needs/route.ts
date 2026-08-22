import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import {
  getShoppingListRows,
  consolidateShoppingListRows,
} from "@/lib/inventory/shopping-list-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What needs buying right now, consolidated across properties.
 *
 * Read-only and always fresh. The list is DERIVED from current stock rather
 * than stored, which is why a finished count immediately changes what the
 * shopper sees: there is no second list to regenerate, fall out of date, or
 * forget about.
 *
 * Built on the SAME `getShoppingListRows` the printed sheet and the emailed
 * list already use. The trigger and the quantity are computed once, in one
 * place — a shopping screen that disagreed with the emailed list about what to
 * buy would be worse than having no screen.
 *
 * All three shapes come back in one response: raw per-property needs, per-item
 * totals, and per-supplier baskets. They are cheap to derive from the same
 * rows, and making a client re-fetch to switch between "by item" and "by
 * supplier" would feel slow for no reason.
 */
export async function GET(req: NextRequest) {
  try {
    // Cleaners and laundry staff do the shopping, so they can see the list.
    await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.CLEANER, Role.LAUNDRY]);

    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get("propertyId")?.trim();

    const rows = await getShoppingListRows(propertyId ? { scope: propertyId } : undefined);
    return NextResponse.json(consolidateShoppingListRows(rows));
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not load the shopping list." }, { status });
  }
}
