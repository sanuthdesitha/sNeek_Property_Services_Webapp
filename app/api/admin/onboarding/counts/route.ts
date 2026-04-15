import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const pendingCount = await db.propertyOnboardingSurvey.count({
      where: { status: "PENDING_REVIEW" },
    });
    const draftCount = await db.propertyOnboardingSurvey.count({
      where: { status: "DRAFT" },
    });
    return NextResponse.json({ pendingCount, draftCount });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
