import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { getShoppingListGrouped } from "@/lib/inventory/shopping-list-report";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") ?? "all";
    const grouped = await getShoppingListGrouped(scope);
    return NextResponse.json(grouped);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
