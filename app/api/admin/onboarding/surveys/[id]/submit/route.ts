import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await db.propertyOnboardingSurvey.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Survey not found." }, { status: 404 });
    if (existing.status !== "DRAFT") return NextResponse.json({ error: "Only draft surveys can be submitted." }, { status: 409 });

    const survey = await db.propertyOnboardingSurvey.update({
      where: { id: params.id },
      data: { status: "PENDING_REVIEW", submittedAt: new Date() },
    });

    return NextResponse.json(survey);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
