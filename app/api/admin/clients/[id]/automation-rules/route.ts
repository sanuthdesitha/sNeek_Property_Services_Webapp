import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const ruleSchema = z.object({
  triggerType: z.enum(["POST_JOB_REVIEW", "POST_JOB_NEXT_CLEAN", "POST_JOB_DISCOUNT", "POST_JOB_CUSTOM"]),
  jobType: z.string().optional().nullable(),
  templateId: z.string().cuid().optional().nullable(),
  delayMinutes: z.number().int().min(0).optional().default(120),
  isEnabled: z.boolean().optional().default(false),
  channel: z.enum(["EMAIL", "SMS", "BOTH"]).optional().default("EMAIL"),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const rules = await db.clientAutomationRule.findMany({
      where: { clientId: params.id },
      include: { template: { select: { id: true, name: true, triggerType: true, channel: true } } },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(rules);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const client = await db.client.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!client) return NextResponse.json({ error: "Client not found." }, { status: 404 });

    const body = ruleSchema.parse(await req.json());
    const rule = await db.clientAutomationRule.create({
      data: { ...body, clientId: params.id },
      include: { template: { select: { id: true, name: true, triggerType: true, channel: true } } },
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed" }, { status });
  }
}
