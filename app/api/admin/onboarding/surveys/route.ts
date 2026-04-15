import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { createSurveySchema } from "@/lib/validations/onboarding";
import { generateSurveyNumber } from "@/lib/onboarding/survey-number";

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { surveyNumber: { contains: search, mode: "insensitive" } },
        { propertyName: { contains: search, mode: "insensitive" } },
        { propertyAddress: { contains: search, mode: "insensitive" } },
      ];
    }

    const surveys = await db.propertyOnboardingSurvey.findMany({
      where,
      include: {
        existingClient: { select: { id: true, name: true } },
        createdClient: { select: { id: true, name: true } },
        submittedBy: { select: { id: true, name: true, email: true } },
        adminReviewer: { select: { id: true, name: true } },
        _count: { select: { appliances: true, specialRequests: true, accessDetails: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(surveys);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSurveySchema.parse(await req.json());

    const surveyNumber = await generateSurveyNumber();

    const survey = await db.propertyOnboardingSurvey.create({
      data: {
        surveyNumber,
        sourceType: "ADMIN_CREATED",
        submittedById: session.user.id,
        isNewClient: body.isNewClient ?? false,
        clientData: body.clientData ? (body.clientData as any) : undefined,
        existingClientId: body.existingClientId || undefined,
        propertyAddress: body.propertyAddress || undefined,
        propertySuburb: body.propertySuburb || undefined,
        propertyState: body.propertyState,
        propertyPostcode: body.propertyPostcode || undefined,
        propertyName: body.propertyName || undefined,
        propertyNotes: body.propertyNotes || undefined,
        bedrooms: body.bedrooms,
        bathrooms: body.bathrooms,
        hasBalcony: body.hasBalcony,
        floorCount: body.floorCount,
        propertyType: body.propertyType || undefined,
        sizeSqm: body.sizeSqm || undefined,
        requestedCleanerCount: body.requestedCleanerCount,
        icalUrl: body.icalUrl || undefined,
        icalProvider: body.icalProvider || undefined,
        appliances: body.appliances?.length
          ? { create: body.appliances.map((a) => ({ applianceType: a.applianceType, conditionNote: a.conditionNote, requiresClean: a.requiresClean })) }
          : undefined,
        specialRequests: body.specialRequests?.length
          ? { create: body.specialRequests.map((r) => ({ description: r.description, priority: r.priority, area: r.area })) }
          : undefined,
        laundryDetail: body.laundryDetail?.hasLaundry
          ? { create: { hasLaundry: body.laundryDetail.hasLaundry, washerType: body.laundryDetail.washerType, dryerType: body.laundryDetail.dryerType, laundryLocation: body.laundryDetail.laundryLocation, suppliesProvided: body.laundryDetail.suppliesProvided, detergentType: body.laundryDetail.detergentType, notes: body.laundryDetail.notes } }
          : undefined,
        accessDetails: body.accessDetails?.length
          ? { create: body.accessDetails.map((d, i) => ({ detailType: d.detailType, value: d.value, photoUrl: d.photoUrl, photoKey: d.photoKey, annotations: d.annotations as any, sortOrder: d.sortOrder ?? i })) }
          : undefined,
        jobTypeAnswers: body.jobTypeAnswers?.length
          ? { create: body.jobTypeAnswers.map((a) => ({ jobType: a.jobType as any, answers: a.answers as any, isComplete: a.isComplete })) }
          : undefined,
      },
      include: {
        appliances: true,
        specialRequests: true,
        laundryDetail: true,
        accessDetails: true,
        jobTypeAnswers: true,
      },
    });

    return NextResponse.json(survey, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
