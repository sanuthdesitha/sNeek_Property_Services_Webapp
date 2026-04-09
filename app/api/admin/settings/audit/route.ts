import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function GET() {
  try {
    await requireRole([Role.ADMIN]);
    const entries = await db.auditLog.findMany({
      where: {
        entity: "AppSettings",
        entityId: "app",
      },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    return NextResponse.json(entries);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load audit log." }, { status });
  }
}
