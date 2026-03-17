import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listCleanerAvailabilities } from "@/lib/accounts/availability";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId")?.trim() || null;

    if (userId) {
      const rows = await listCleanerAvailabilities([userId]);
      return NextResponse.json(rows[0] ?? null);
    }

    const cleaners = await db.user.findMany({
      where: { role: Role.CLEANER },
      select: { id: true, name: true, email: true, isActive: true },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
    const availabilityRows = await listCleanerAvailabilities(cleaners.map((row) => row.id));
    const byUserId = new Map(availabilityRows.map((row) => [row.userId, row]));
    return NextResponse.json(
      cleaners.map((cleaner) => ({
        ...cleaner,
        availability: byUserId.get(cleaner.id) ?? null,
      }))
    );
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load cleaner availability." }, { status });
  }
}

