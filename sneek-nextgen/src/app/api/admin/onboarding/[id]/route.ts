import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest } from "next/server";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireApiRole("ADMIN", "OPS_MANAGER");
  const { id } = await params;

  const survey = await prisma.propertySurvey.findUnique({
    where: { id },
    include: {
      sections: true,
      photos: true,
      estimations: true,
      checklists: true,
      packages: {
        include: {
          items: true,
          approvalLogs: {
            include: { admin: { select: { id: true, name: true } } },
          },
        },
      },
      surveyor: { select: { id: true, name: true, email: true } },
      client: { select: { id: true, name: true, email: true } },
    },
  });

  if (!survey) return apiError("Survey not found", 404);

  return apiSuccess(survey);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireApiRole("ADMIN", "OPS_MANAGER");
  const { id } = await params;
  const body = await req.json();

  const { sectionKey, data } = body;

  if (!sectionKey || !data) {
    return apiError("sectionKey and data are required", 400);
  }

  const section = await prisma.propertySurveySection.upsert({
    where: {
      surveyId_sectionKey: { surveyId: id, sectionKey: sectionKey as never },
    },
    update: { data, completedAt: new Date() },
    create: {
      surveyId: id,
      sectionKey: sectionKey as never,
      data,
      completedAt: new Date(),
    },
  });

  return apiSuccess(section);
}
