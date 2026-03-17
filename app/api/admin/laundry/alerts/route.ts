import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const alerts = await db.laundryTask.findMany({
      where: { status: "FLAGGED" },
      include: {
        property: {
          select: { name: true, suburb: true, linenBufferSets: true },
        },
        job: { select: { scheduledDate: true } },
        confirmations: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { pickupDate: "asc" },
    });
    return NextResponse.json(alerts);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
