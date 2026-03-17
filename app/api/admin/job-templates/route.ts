import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getJobTemplates, saveJobTemplates } from "@/lib/job-templates";

const createTemplateSchema = z.object({
  name: z.string().trim().min(1),
  jobType: z.nativeEnum(JobType),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  estimatedHours: z.number().positive().optional(),
  notes: z.string().trim().optional(),
  internalNotes: z.string().trim().optional(),
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

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const templates = await getJobTemplates();
    return NextResponse.json(templates);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createTemplateSchema.parse(await req.json());
    const current = await getJobTemplates();
    const next = [
      {
        id: randomUUID(),
        name: body.name.trim(),
        jobType: body.jobType,
        startTime: body.startTime,
        dueTime: body.dueTime,
        endTime: body.endTime,
        estimatedHours: body.estimatedHours,
        notes: body.notes?.trim() || undefined,
        internalNotes: body.internalNotes?.trim() || undefined,
        isDraft: body.isDraft ?? false,
        tags: body.tags ?? [],
        attachments: body.attachments ?? [],
        earlyCheckin: body.earlyCheckin,
        lateCheckout: body.lateCheckout,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ];
    const saved = await saveJobTemplates(next);
    return NextResponse.json(saved[0], { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
