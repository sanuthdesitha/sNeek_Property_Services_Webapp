import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { depositShoppingRunToOnHand } from "@/lib/inventory/held-stock";

// Move a run's purchased items into the run owner's on-hand ledger.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const result = await depositShoppingRunToOnHand(params.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
