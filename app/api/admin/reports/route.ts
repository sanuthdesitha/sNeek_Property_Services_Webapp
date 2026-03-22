import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const reports = await db.report.findMany({
      include: {
        job: {
          select: {
            id: true,
            scheduledDate: true,
            jobType: true,
            status: true,
            property: { select: { name: true, suburb: true, client: { select: { name: true } } } },
          },
        },
        visibilityUpdatedBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json(reports);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
