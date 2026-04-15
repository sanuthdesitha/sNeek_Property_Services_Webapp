import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { updateSurveySchema } from "@/lib/validations/onboarding";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const survey = await db.propertyOnboardingSurvey.findUnique({
      where: { id: params.id },
      include: {
        appliances: true,
        specialRequests: true,
        laundryDetail: true,
        accessDetails: { orderBy: { sortOrder: "asc" } },
        jobTypeAnswers: true,
        existingClient: { select: { id: true, name: true, email: true } },
        createdClient: { select: { id: true, name: true } },
        submittedBy: { select: { id: true, name: true, email: true } },
        adminReviewer: { select: { id: true, name: true } },
      },
    });
    if (!survey) return NextResponse.json({ error: "Survey not found." }, { status: 404 });
    return NextResponse.json(survey);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateSurveySchema.parse(await req.json());

    const existing = await db.propertyOnboardingSurvey.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Survey not found." }, { status: 404 });
    if (existing.status === "APPROVED") return NextResponse.json({ error: "Cannot modify approved survey." }, { status: 409 });

    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) data[key] = value;
    }

    const survey = await db.propertyOnboardingSurvey.update({
      where: { id: params.id },
      data,
      include: {
        appliances: true,
        specialRequests: true,
        laundryDetail: true,
        accessDetails: true,
        jobTypeAnswers: true,
      },
    });

    return NextResponse.json(survey);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await db.propertyOnboardingSurvey.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Survey not found." }, { status: 404 });
    if (existing.status === "APPROVED") return NextResponse.json({ error: "Cannot delete approved survey." }, { status: 409 });

    await db.propertyOnboardingSurvey.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
