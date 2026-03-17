import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getJobTemplates, saveJobTemplates } from "@/lib/job-templates";

const updateTemplateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  jobType: z.nativeEnum(JobType).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  estimatedHours: z.number().positive().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  internalNotes: z.string().trim().optional().nullable(),
  isDraft: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  attachments: z
    .array(
      z.object({
        key: z.string().min(1),
        url: z.string().min(1),
        name: z.string().min(1),
        mimeType: z.string().optional(),
        sizeBytes: z.number().nonnegative().optional(),
      })
    )
    .optional(),
  earlyCheckin: z
    .object({
      enabled: z.boolean().optional(),
      preset: z.enum(["none", "11:00", "12:30", "custom"]).optional(),
      time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    })
    .optional(),
  lateCheckout: z
    .object({
      enabled: z.boolean().optional(),
      preset: z.enum(["none", "11:00", "12:30", "custom"]).optional(),
      time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    })
    .optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateTemplateSchema.parse(await req.json());
    const current = await getJobTemplates();
    const idx = current.findIndex((row) => row.id === params.id);
    if (idx < 0) {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }

    const target = current[idx];
    const updated = {
      ...target,
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.jobType !== undefined ? { jobType: body.jobType } : {}),
      ...(body.startTime !== undefined ? { startTime: body.startTime ?? undefined } : {}),
      ...(body.dueTime !== undefined ? { dueTime: body.dueTime ?? undefined } : {}),
      ...(body.endTime !== undefined ? { endTime: body.endTime ?? undefined } : {}),
      ...(body.estimatedHours !== undefined ? { estimatedHours: body.estimatedHours ?? undefined } : {}),
      ...(body.notes !== undefined ? { notes: body.notes?.trim() || undefined } : {}),
      ...(body.internalNotes !== undefined ? { internalNotes: body.internalNotes?.trim() || undefined } : {}),
      ...(body.isDraft !== undefined ? { isDraft: body.isDraft } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.attachments !== undefined ? { attachments: body.attachments } : {}),
      ...(body.earlyCheckin !== undefined ? { earlyCheckin: body.earlyCheckin } : {}),
      ...(body.lateCheckout !== undefined ? { lateCheckout: body.lateCheckout } : {}),
    };

    current[idx] = updated;
    await saveJobTemplates(current);
    return NextResponse.json(updated);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const current = await getJobTemplates();
    const next = current.filter((row) => row.id !== params.id);
    if (next.length === current.length) {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }
    await saveJobTemplates(next);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
