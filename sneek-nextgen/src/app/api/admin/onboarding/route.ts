import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await requireApiRole("ADMIN", "OPS_MANAGER");
  if (session instanceof NextResponse) return session;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const surveyorId = searchParams.get("surveyorId");

  const surveys = await prisma.propertySurvey.findMany({
    where: {
      ...(status && { status: status as never }),
      ...(surveyorId && { surveyorId }),
    },
    include: {
      surveyor: { select: { id: true, name: true, email: true } },
      client: { select: { id: true, name: true } },
      _count: { select: { photos: true, sections: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return apiSuccess({ surveys, total: surveys.length });
}

export async function POST(req: NextRequest) {
  const session = await requireApiRole("ADMIN", "OPS_MANAGER");
  if (session instanceof NextResponse) return session;

  const body = await req.json();

  const survey = await prisma.propertySurvey.create({
    data: {
      surveyorId: session.user.id,
      clientId: body.clientId ?? null,
      status: "DRAFT",
      notes: body.notes,
    },
  });

  return apiSuccess(survey);
}
