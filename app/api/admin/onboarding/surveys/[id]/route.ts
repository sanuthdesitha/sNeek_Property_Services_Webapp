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

function buildNestedUpdate(body: Record<string, unknown>, existing: any) {
  const data: Record<string, unknown> = {};

  // Scalar fields
  const scalarKeys = [
    "isNewClient", "clientData", "existingClientId",
    "propertyAddress", "propertySuburb", "propertyState", "propertyPostcode",
    "propertyName", "propertyNotes",
    "bedrooms", "bathrooms", "hasBalcony", "floorCount",
    "propertyType", "sizeSqm",
    "requestedCleanerCount", "estimatedCleanerCount", "estimatedHours", "estimatedPrice",
    "icalUrl", "icalProvider",
    "adminNotes", "adminOverrides",
  ];
  for (const key of scalarKeys) {
    if (body[key] !== undefined) data[key] = body[key];
  }

  // Nested: appliances (full replace)
  if (body.appliances !== undefined) {
    const appliances = body.appliances as Array<Record<string, unknown>>;
    data.appliances = {
      deleteMany: {},
      create: appliances.map((a) => ({
        applianceType: a.applianceType,
        conditionNote: a.conditionNote ?? null,
        requiresClean: a.requiresClean ?? true,
      })),
    };
  }

  // Nested: specialRequests (full replace)
  if (body.specialRequests !== undefined) {
    const requests = body.specialRequests as Array<Record<string, unknown>>;
    data.specialRequests = {
      deleteMany: {},
      create: requests.map((r) => ({
        description: r.description,
        priority: r.priority ?? "NORMAL",
        area: r.area ?? null,
      })),
    };
  }

  // Nested: laundryDetail (upsert)
  if (body.laundryDetail !== undefined) {
    const ld = body.laundryDetail as Record<string, unknown> | null;
    if (ld && ld.hasLaundry === true) {
      data.laundryDetail = {
        upsert: {
          create: {
            hasLaundry: ld.hasLaundry ?? false,
            washerType: ld.washerType ?? null,
            dryerType: ld.dryerType ?? null,
            laundryLocation: ld.laundryLocation ?? null,
            suppliesProvided: ld.suppliesProvided ?? false,
            detergentType: ld.detergentType ?? null,
            notes: ld.notes ?? null,
          },
          update: {
            hasLaundry: ld.hasLaundry ?? false,
            washerType: ld.washerType ?? null,
            dryerType: ld.dryerType ?? null,
            laundryLocation: ld.laundryLocation ?? null,
            suppliesProvided: ld.suppliesProvided ?? false,
            detergentType: ld.detergentType ?? null,
            notes: ld.notes ?? null,
          },
        },
      };
    } else if (existing.laundryDetail) {
      data.laundryDetail = { delete: true };
    }
  }

  // Nested: accessDetails (full replace)
  if (body.accessDetails !== undefined) {
    const details = body.accessDetails as Array<Record<string, unknown>>;
    data.accessDetails = {
      deleteMany: {},
      create: details.map((d, i) => ({
        detailType: d.detailType,
        value: d.value ?? null,
        photoUrl: d.photoUrl ?? null,
        photoKey: d.photoKey ?? null,
        annotations: d.annotations ?? null,
        sortOrder: d.sortOrder ?? i,
      })),
    };
  }

  // Nested: jobTypeAnswers (full replace)
  if (body.jobTypeAnswers !== undefined) {
    const answers = body.jobTypeAnswers as Array<Record<string, unknown>>;
    data.jobTypeAnswers = {
      deleteMany: {},
      create: answers.map((a) => ({
        jobType: a.jobType,
        answers: a.answers ?? {},
        isComplete: a.isComplete ?? false,
      })),
    };
  }

  return data;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateSurveySchema.parse(await req.json());

    const existing = await db.propertyOnboardingSurvey.findUnique({
      where: { id: params.id },
      include: { laundryDetail: true },
    });
    if (!existing) return NextResponse.json({ error: "Survey not found." }, { status: 404 });
    if (existing.status === "APPROVED") return NextResponse.json({ error: "Cannot modify approved survey." }, { status: 409 });

    const data = buildNestedUpdate(body as Record<string, unknown>, existing);

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
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
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
