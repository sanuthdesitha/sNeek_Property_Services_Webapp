import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { buildDefaultQaTemplateSchema, jobTypeLabel } from "@/lib/qa/templates";

const schema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  serviceType: z.nativeEnum(JobType),
  propertyId: z.string().trim().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
  templateSchema: z.any().optional(),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [templates, properties] = await Promise.all([
      db.qaFormTemplate.findMany({
        include: { property: { select: { id: true, name: true, suburb: true } } },
        orderBy: [{ isActive: "desc" }, { serviceType: "asc" }, { version: "desc" }],
      }),
      db.property.findMany({
        where: { isActive: true },
        select: { id: true, name: true, suburb: true },
        orderBy: [{ name: "asc" }],
        take: 500,
      }),
    ]);
    return NextResponse.json({ templates, properties, jobTypes: Object.values(JobType) });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = schema.parse(await req.json());
    const propertyId = body.propertyId || null;
    const latest = await db.qaFormTemplate.findFirst({
      where: { serviceType: body.serviceType, propertyId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const template = await db.qaFormTemplate.create({
      data: {
        name: body.name || `${propertyId ? "Property" : "Default"} QA - ${jobTypeLabel(body.serviceType)}`,
        serviceType: body.serviceType,
        propertyId,
        version: (latest?.version ?? 0) + 1,
        isActive: body.isActive ?? true,
        schema: (body.templateSchema ?? buildDefaultQaTemplateSchema(body.serviceType)) as any,
      },
    });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "QA_TEMPLATE_CREATE",
        entity: "QaFormTemplate",
        entityId: template.id,
        after: template as any,
      },
    });
    return NextResponse.json(template);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
