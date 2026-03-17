import { NextRequest, NextResponse } from "next/server";
import { Role, JobType } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  deleteRecurringJobRule,
  getRecurringJobRules,
  upsertRecurringJobRule,
  type RecurringJobRule,
} from "@/lib/ops/recurring";

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  isActive: z.boolean().optional(),
  propertyId: z.string().trim().min(1).optional(),
  jobType: z.nativeEnum(JobType).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  startDate: z.string().date().nullable().optional(),
  endDate: z.string().date().nullable().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  estimatedHours: z.number().positive().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  assigneeIds: z.array(z.string().trim().min(1)).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const current = (await getRecurringJobRules()).find((item) => item.id === params.id);
    if (!current) return NextResponse.json({ error: "Rule not found." }, { status: 404 });

    const merged: RecurringJobRule = {
      ...current,
      ...body,
      startDate: body.startDate === null ? undefined : body.startDate ?? current.startDate,
      endDate: body.endDate === null ? undefined : body.endDate ?? current.endDate,
      startTime: body.startTime === null ? undefined : body.startTime ?? current.startTime,
      dueTime: body.dueTime === null ? undefined : body.dueTime ?? current.dueTime,
      estimatedHours:
        body.estimatedHours === null ? undefined : body.estimatedHours ?? current.estimatedHours,
      notes: body.notes === null ? undefined : body.notes ?? current.notes,
    };

    const rules = await upsertRecurringJobRule(merged);
    return NextResponse.json({ ok: true, rules });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update recurring rule." }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const deleted = await deleteRecurringJobRule(params.id);
    if (!deleted) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not delete recurring rule." }, { status });
  }
}

