import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { marketedJobTypeSchema } from "@/lib/marketing/job-types";
import { getMarketingCampaigns, saveMarketingCampaigns } from "@/lib/marketing/store";

const campaignSchema = z.object({
  code: z.string().trim().min(2).max(40).transform((value) => value.toUpperCase()),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  discountType: z.enum(["PERCENT", "FIXED"]),
  discountValue: z.number().min(0).max(100000),
  minSubtotal: z.number().min(0).max(100000).optional().nullable(),
  jobTypes: z.array(marketedJobTypeSchema).optional().default([]),
  usageLimit: z.number().int().min(1).max(100000).optional().nullable(),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

function buildCampaignValidationResponse(result: z.SafeParseError<unknown>) {
  const flattened = result.error.flatten();
  const fieldErrorEntries = Object.entries(flattened.fieldErrors as Record<string, string[] | undefined>);
  const fieldErrors = Object.fromEntries(
    fieldErrorEntries.map(([key, value]) => [key, value?.[0] ?? null])
  );
  return NextResponse.json(
    {
      error: "Please correct the campaign details and try again.",
      fieldErrors,
    },
    { status: 400 }
  );
}

export async function GET() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const rows = await getMarketingCampaigns();
  return NextResponse.json(rows.sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.createdAt.localeCompare(a.createdAt)));
}

export async function POST(req: NextRequest) {
  await requireRole([Role.ADMIN]);
  const payload = await req.json();
  const parsed = campaignSchema.safeParse(payload);
  if (!parsed.success) {
    return buildCampaignValidationResponse(parsed);
  }
  const body = parsed.data;
  const current = await getMarketingCampaigns();
  const duplicate = current.find((campaign) => campaign.code === body.code);
  if (duplicate) {
    return NextResponse.json({ error: "A campaign with this code already exists." }, { status: 409 });
  }

  const timestamp = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    code: body.code,
    title: body.title,
    description: body.description ?? null,
    discountType: body.discountType,
    discountValue: body.discountValue,
    minSubtotal: body.minSubtotal ?? null,
    jobTypes: body.jobTypes.length > 0 ? body.jobTypes : null,
    usageLimit: body.usageLimit ?? null,
    usageCount: 0,
    startsAt: body.startsAt ?? null,
    endsAt: body.endsAt ?? null,
    isActive: body.isActive,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await saveMarketingCampaigns([created, ...current]);
  return NextResponse.json(created, { status: 201 });
}
