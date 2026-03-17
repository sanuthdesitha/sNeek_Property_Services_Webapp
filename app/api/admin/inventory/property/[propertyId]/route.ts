import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: { propertyId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const stocks = await db.propertyStock.findMany({
      where: { propertyId: params.propertyId },
      include: { item: true },
      orderBy: [{ item: { location: "asc" } }, { item: { category: "asc" } }, { item: { name: "asc" } }],
    });
    return NextResponse.json(stocks);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
