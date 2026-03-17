import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Role, JobType } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  generateRecurringJobs,
  getRecurringJobRules,
  upsertRecurringJobRule,
  type RecurringJobRule,
} from "@/lib/ops/recurring";

const ruleSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1),
  isActive: z.boolean().optional(),
  propertyId: z.string().trim().min(1),
  jobType: z.nativeEnum(JobType),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  estimatedHours: z.number().positive().optional(),
  notes: z.string().trim().optional(),
  assigneeIds: z.array(z.string().trim().min(1)).optional(),
});

const generateSchema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
  ruleIds: z.array(z.string().trim().min(1)).optional(),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const rules = await getRecurringJobRules();
    return NextResponse.json(rules);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not fetch recurring rules." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));

    if (body?.action === "generate") {
      const payload = generateSchema.parse(body);
      const result = await generateRecurringJobs({
        startDate: payload.startDate,
        endDate: payload.endDate,
        ruleIds: payload.ruleIds,
        actorUserId: session.user.id,
      });
      return NextResponse.json(result);
    }

    const parsed = ruleSchema.parse(body);
    const rule: RecurringJobRule = {
      id: parsed.id ?? randomUUID(),
      name: parsed.name,
      isActive: parsed.isActive !== false,
      propertyId: parsed.propertyId,
      jobType: parsed.jobType,
      daysOfWeek: parsed.daysOfWeek,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      startTime: parsed.startTime,
      dueTime: parsed.dueTime,
      estimatedHours: parsed.estimatedHours,
      notes: parsed.notes,
      assigneeIds: parsed.assigneeIds ?? [],
    };
    const rules = await upsertRecurringJobRule(rule);
    return NextResponse.json({ ok: true, rules }, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not save recurring rule." }, { status });
  }
}

