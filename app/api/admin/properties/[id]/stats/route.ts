import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { getPropertyStats } from "@/lib/accounts/property-stats";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const stats = await getPropertyStats(params.id);
    return NextResponse.json(stats);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to load property stats" },
      { status: 500 }
    );
  }
}
