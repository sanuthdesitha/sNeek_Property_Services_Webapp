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

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const campaigns = await db.emailCampaign.findMany({
      include: { createdBy: { select: { name: true, email: true } } },
      orderBy: [{ createdAt: "desc" }],
    });
    return NextResponse.json(campaigns);
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not load campaigns." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = campaignSchema.parse(await req.json());
    const campaign = await db.emailCampaign.create({
      data: {
        name: body.name,
        subject: body.subject,
        htmlBody: body.htmlBody,
        audience: body.audience as any,
        status: body.status,
        scheduledAt: body.status === "scheduled" && body.scheduledAt ? new Date(body.scheduledAt) : null,
        createdById: session.user.id,
      },
      include: { createdBy: { select: { name: true, email: true } } },
    });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error: any) {
    const status = error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not create campaign." }, { status });
  }
}
