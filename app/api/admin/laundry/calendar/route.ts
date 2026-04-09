import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const startParam = searchParams.get("start");
    const endParam = searchParams.get("end");

    const start = startParam ? new Date(startParam) : new Date();
    const end = endParam ? new Date(endParam) : new Date(start.getTime() + 31 * 86400_000);

    const tasks = await db.laundryTask.findMany({
      where: {
        OR: [
          { pickupDate: { gte: start, lt: end } },
          { dropoffDate: { gte: start, lt: end } },
          {
            AND: [
              { pickupDate: { lt: start } },
              { dropoffDate: { gte: end } },
            ],
          },
        ],
      },
      select: {
        id: true,
        status: true,
        pickupDate: true,
        dropoffDate: true,
        flagReason: true,
        property: {
          select: {
            id: true,
            name: true,
            suburb: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ pickupDate: "asc" }, { dropoffDate: "asc" }],
    });

    return NextResponse.json(tasks);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load laundry calendar." }, { status });
  }
}
