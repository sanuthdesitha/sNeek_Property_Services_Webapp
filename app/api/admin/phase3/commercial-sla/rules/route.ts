import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  createCommercialSlaRule,
  listCommercialSlaRules,
} from "@/lib/phase3/commercial-sla";

const schema = z.object({
  name: z.string().trim().min(1).max(160),
  isActive: z.boolean().optional(),
  clientId: z.string().trim().min(1).optional().nullable(),
  propertyId: z.string().trim().min(1).optional().nullable(),
  jobType: z.nativeEnum(JobType).optional().nullable(),
  maxStartDelayMinutes: z.number().int().min(0).max(1440).optional(),
  maxCompletionDelayMinutes: z.number().int().min(0).max(4320).optional(),
  escalationDelayMinutes: z.number().int().min(0).max(1440).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const rows = await listCommercialSlaRules();
    return NextResponse.json(rows);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const created = await createCommercialSlaRule(body);
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "COMMERCIAL_SLA_RULE_CREATE",
        entity: "CommercialSlaRule",
        entityId: created.id,
        after: created as any,
      },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Create failed." }, { status });
  }
}

