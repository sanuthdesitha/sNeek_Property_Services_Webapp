import { NextRequest, NextResponse } from "next/server";
import { Prisma, Role, JobType, FormKind } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getChecklist } from "@/lib/checklists/store";
import { checklistToFormSchema } from "@/lib/checklists/to-form";

const schema = z.object({ jobType: z.string().min(1), name: z.string().trim().max(120).optional() });

/**
 * Generate an editable job FormTemplate from a service checklist (the
 * "generate, then editable" model). Creates a CUSTOM draft template whose
 * sections/fields mirror the checklist's covered items — admins refine it in
 * the form builder and publish.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json());

    if (!(body.jobType in JobType)) {
      return NextResponse.json({ error: "Unknown service type." }, { status: 400 });
    }
    const checklist = await getChecklist(body.jobType);
    if (!checklist || checklist.sections.length === 0) {
      return NextResponse.json({ error: "No checklist found for this service." }, { status: 404 });
    }

    const formSchema = checklistToFormSchema(checklist);
    if (formSchema.sections.length === 0) {
      return NextResponse.json({ error: "Checklist has no covered items to turn into a form." }, { status: 400 });
    }

    const last = await db.formTemplate.findFirst({
      where: { kind: FormKind.CUSTOM },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const prettyType = body.jobType.toLowerCase().replace(/_/g, " ");
    const template = await db.formTemplate.create({
      data: {
        name: body.name?.trim() || `${prettyType} checklist form`,
        serviceType: body.jobType as JobType,
        kind: FormKind.CUSTOM,
        version: (last?.version ?? 0) + 1,
        isActive: false, // starts as a draft to edit + publish in the builder
        schema: formSchema as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, name: true },
    });

    await db.auditLog
      .create({
        data: {
          userId: session.user.id,
          action: "GENERATE_FORM_FROM_CHECKLIST",
          entity: "FormTemplate",
          entityId: template.id,
          after: { jobType: body.jobType, sections: formSchema.sections.length } as any,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ok: true, templateId: template.id, name: template.name });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not generate form." }, { status });
  }
}
