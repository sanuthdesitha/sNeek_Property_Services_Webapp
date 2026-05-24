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

// Marketing engine v1 — partial-update path for the new multi-channel columns.
// Accepted only when the request body looks like a marketing-engine patch
// (presence of channel/campaignStatus/scheduledFor/templateId).
const marketingPatchSchema = z.object({
  channel: z.enum(["EMAIL", "SMS", "BOTH"]).optional(),
  campaignStatus: z
    .enum(["DRAFT", "SCHEDULED", "SENDING", "SENT", "FAILED", "PAUSED", "CANCELLED"])
    .optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  templateId: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const raw = await req.json();

    // If the body looks like a marketing-engine partial patch, route to that path
    const isMarketingPatch =
      raw && typeof raw === "object" &&
      ("channel" in raw || "campaignStatus" in raw || "scheduledFor" in raw || "templateId" in raw) &&
      !("name" in raw && "subject" in raw && "htmlBody" in raw && "audience" in raw);

    if (isMarketingPatch) {
      const patch = marketingPatchSchema.parse(raw);
      const data: any = {};
      if (patch.channel !== undefined) data.channel = patch.channel;
      if (patch.campaignStatus !== undefined) data.campaignStatus = patch.campaignStatus;
      if (patch.scheduledFor !== undefined) data.scheduledFor = patch.scheduledFor ? new Date(patch.scheduledFor) : null;
      if (patch.templateId !== undefined) data.templateId = patch.templateId;
      const campaign = await (db as any).emailCampaign.update({ where: { id: params.id }, data });
      return NextResponse.json({ campaign });
    }

    const body = campaignSchema.parse(raw);
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
