import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const patchSchema = z.object({
  triggerType: z.enum(["POST_JOB_REVIEW", "POST_JOB_NEXT_CLEAN", "POST_JOB_DISCOUNT", "POST_JOB_CUSTOM"]).optional(),
  jobType: z.string().optional().nullable(),
  templateId: z.string().cuid().optional().nullable(),
  delayMinutes: z.number().int().min(0).optional(),
  isEnabled: z.boolean().optional(),
  channel: z.enum(["EMAIL", "SMS", "BOTH"]).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; ruleId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const body = patchSchema.parse(await req.json());
    const rule = await db.clientAutomationRule.update({
      where: { id: params.ruleId, clientId: params.id },
      data: body,
      include: { template: { select: { id: true, name: true, triggerType: true, channel: true } } },
    });

    return NextResponse.json(rule);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; ruleId: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await db.clientAutomationRule.delete({
      where: { id: params.ruleId, clientId: params.id },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
