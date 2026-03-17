import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  deleteCommercialSlaRuleById,
  getCommercialSlaRuleById,
  updateCommercialSlaRuleById,
} from "@/lib/phase3/commercial-sla";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  isActive: z.boolean().optional(),
  clientId: z.string().trim().min(1).optional().nullable(),
  propertyId: z.string().trim().min(1).optional().nullable(),
  jobType: z.nativeEnum(JobType).optional().nullable(),
  maxStartDelayMinutes: z.number().int().min(0).max(1440).optional(),
  maxCompletionDelayMinutes: z.number().int().min(0).max(4320).optional(),
  escalationDelayMinutes: z.number().int().min(0).max(1440).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await getCommercialSlaRuleById(params.id);
    if (!existing) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const updated = await updateCommercialSlaRuleById(params.id, body);
    if (!updated) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "COMMERCIAL_SLA_RULE_UPDATE",
        entity: "CommercialSlaRule",
        entityId: updated.id,
        before: existing as any,
        after: updated as any,
      },
    });
    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Update failed." }, { status });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await getCommercialSlaRuleById(params.id);
    if (!existing) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
    const ok = await deleteCommercialSlaRuleById(params.id);
    if (!ok) return NextResponse.json({ error: "Rule not found." }, { status: 404 });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "COMMERCIAL_SLA_RULE_DELETE",
        entity: "CommercialSlaRule",
        entityId: params.id,
        before: existing as any,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Delete failed." }, { status });
  }
}

