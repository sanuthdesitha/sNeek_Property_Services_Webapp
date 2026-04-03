import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { marketedJobTypeSchema } from "@/lib/marketing/job-types";
import { getMarketingCampaigns, saveMarketingCampaigns } from "@/lib/marketing/store";

const campaignSchema = z.object({
  code: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()).optional(),
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  discountType: z.enum(["PERCENT", "FIXED"]).optional(),
  discountValue: z.number().min(0).max(100000).optional(),
  minSubtotal: z.number().min(0).max(100000).optional().nullable(),
  jobTypes: z.array(marketedJobTypeSchema).optional(),
  usageLimit: z.number().int().min(1).max(100000).optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN]);
  const body = campaignSchema.parse(await req.json());
  const current = await getMarketingCampaigns();
  const index = current.findIndex((campaign) => campaign.id === params.id);
  if (index < 0) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }

  const updated = {
    ...current[index],
    code: body.code ?? current[index].code,
    title: body.title ?? current[index].title,
    description: body.description === undefined ? current[index].description : body.description,
    discountType: body.discountType ?? current[index].discountType,
    discountValue: body.discountValue ?? current[index].discountValue,
    minSubtotal: body.minSubtotal === undefined ? current[index].minSubtotal : body.minSubtotal,
    jobTypes: body.jobTypes === undefined ? current[index].jobTypes : body.jobTypes.length > 0 ? body.jobTypes : null,
    usageLimit: body.usageLimit === undefined ? current[index].usageLimit : body.usageLimit,
    startsAt: body.startsAt === undefined ? current[index].startsAt : body.startsAt,
    endsAt: body.endsAt === undefined ? current[index].endsAt : body.endsAt,
    isActive: body.isActive ?? current[index].isActive,
    updatedAt: new Date().toISOString(),
  };

  const duplicate = current.find((campaign) => campaign.id !== params.id && campaign.code === updated.code);
  if (duplicate) {
    return NextResponse.json({ error: "A campaign with this code already exists." }, { status: 409 });
  }

  const next = [...current];
  next[index] = updated;
  await saveMarketingCampaigns(next);
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN]);
  const current = await getMarketingCampaigns();
  if (!current.some((campaign) => campaign.id === params.id)) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  await saveMarketingCampaigns(current.filter((campaign) => campaign.id !== params.id));
  return NextResponse.json({ ok: true });
}
