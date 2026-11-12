import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { FormOverrideError, validateOverrideTemplates, writePropertyFormOverrides } from "@/lib/properties/form-overrides";

const updateSchema = z.object({
  overrides: z.record(z.string(), z.string().nullable().optional()).default({}),
});

function emptyTemplateMap() {
  return Object.fromEntries(
    Object.values(JobType).map((jobType) => [jobType, [] as Array<{ id: string; name: string; version: number }>])
  ) as Record<JobType, Array<{ id: string; name: string; version: number }>>;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const property = await db.property.findUnique({
      where: { id: params.id },
      select: { id: true, name: true },
    });
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });

    const [settings, templates] = await Promise.all([
      getAppSettings(),
      db.formTemplate.findMany({
        where: { isActive: true },
        select: { id: true, name: true, serviceType: true, version: true },
        orderBy: [{ serviceType: "asc" }, { version: "desc" }, { createdAt: "desc" }],
      }),
    ]);

    const templatesByJobType = emptyTemplateMap();
    for (const template of templates) {
      templatesByJobType[template.serviceType].push({
        id: template.id,
        name: template.name,
        version: template.version,
      });
    }

    const rawOverrides = settings.propertyFormTemplateOverrides?.[params.id] ?? {};
    const overrides: Partial<Record<JobType, string>> = {};
    const globalDefaults: Partial<Record<JobType, string>> = {};

    for (const jobType of Object.values(JobType)) {
      const firstTemplate = templatesByJobType[jobType][0];
      if (firstTemplate?.id) {
        globalDefaults[jobType] = firstTemplate.id;
      }

      const configuredId = rawOverrides[jobType];
      if (!configuredId) continue;
      const isValidForJobType = templatesByJobType[jobType].some((template) => template.id === configuredId);
      if (isValidForJobType) {
        overrides[jobType] = configuredId;
      }
    }

    return NextResponse.json({
      propertyId: property.id,
      propertyName: property.name,
      jobTypes: Object.values(JobType),
      templatesByJobType,
      globalDefaults,
      overrides,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const property = await db.property.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });

    const body = updateSchema.parse(await req.json());
    const requested: Partial<Record<JobType, string>> = {};

    for (const jobType of Object.values(JobType)) {
      const rawTemplateId = body.overrides?.[jobType];
      if (typeof rawTemplateId !== "string") continue;
      const templateId = rawTemplateId.trim();
      if (!templateId) continue;
      requested[jobType] = templateId;
    }

    try {
      await validateOverrideTemplates(requested);
    } catch (error) {
      if (error instanceof FormOverrideError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      null;
    const saved = await writePropertyFormOverrides([{ propertyId: params.id, next: requested }], session.user.id, ipAddress);
    const after = saved.get(params.id) ?? {};

    return NextResponse.json({
      propertyId: params.id,
      overrides: after,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
