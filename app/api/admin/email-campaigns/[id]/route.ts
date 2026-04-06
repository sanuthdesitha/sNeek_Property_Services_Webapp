import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const audienceSchema = z.object({
  type: z.enum(["all_clients", "inactive_clients", "service_type"]),
  filters: z.object({
    daysSinceLastBooking: z.number().int().min(1).max(3650).optional(),
    jobTypes: z.array(z.string().trim().min(1)).optional(),
  }).optional(),
});

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(160),
  subject: z.string().trim().min(1).max(200),
  htmlBody: z.string().trim().min(1).max(200000),
  audience: audienceSchema,
  status: z.enum(["draft", "scheduled"]).default("draft"),
  scheduledAt: z.string().datetime().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = campaignSchema.parse(await req.json());
    const campaign = await db.emailCampaign.update({
      where: { id: params.id },
      data: {
        name: body.name,
        subject: body.subject,
        htmlBody: body.htmlBody,
        audience: body.audience as any,
        status: body.status,
        scheduledAt: body.status === "scheduled" && body.scheduledAt ? new Date(body.scheduledAt) : null,
      },
      include: { createdBy: { select: { name: true, email: true } } },
    });
    return NextResponse.json({ campaign });
  } catch (error: any) {
    const status = error?.code === "P2025" ? 404 : error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not update campaign." }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    await db.emailCampaign.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const status = error?.code === "P2025" ? 404 : error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not delete campaign." }, { status });
  }
}
