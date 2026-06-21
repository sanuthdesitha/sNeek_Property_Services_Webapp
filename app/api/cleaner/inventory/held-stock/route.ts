import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listHeldStock } from "@/lib/inventory/held-stock";

// The signed-in cleaner's own on-hand stock (not yet delivered to a unit).
export async function GET() {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    const holdings = await listHeldStock({ holderUserId: session.user.id });
    return NextResponse.json({
      holdings: holdings.map((h) => ({
        id: h.id,
        quantity: h.quantity,
        item: h.item,
      })),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
