import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { marketedJobTypeSchema } from "@/lib/marketing/job-types";
import { getMarketingSubscriptionPlans, saveMarketingSubscriptionPlans, type MarketingSubscriptionPlanRecord } from "@/lib/marketing/store";

const planSchema = z.object({
  slug: z.string().trim().min(2).max(80),
  name: z.string().trim().min(2).max(120),
  tagline: z.string().trim().max(160).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  serviceTypes: z.array(marketedJobTypeSchema).optional().default([]),
  cadenceOptions: z.array(z.string().trim().min(1).max(50)).optional().default([]),
  startingPrice: z.number().min(0).max(100000).optional().nullable(),
  priceLabel: z.string().trim().max(120).optional().nullable(),
  features: z.array(z.string().trim().min(1).max(160)).optional().default([]),
  themeKey: z.string().trim().max(50).optional().nullable(),
  ctaLabel: z.string().trim().max(80).optional().nullable(),
  ctaHref: z.string().trim().max(240).optional().nullable(),
  isPublished: z.boolean().optional().default(false),
  sortOrder: z.number().int().min(0).max(1000).optional().default(0),
});

export async function GET() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const rows = await getMarketingSubscriptionPlans();
  return NextResponse.json(rows.sort((a: MarketingSubscriptionPlanRecord, b: MarketingSubscriptionPlanRecord) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
}

export async function POST(req: NextRequest) {
  await requireRole([Role.ADMIN]);
  const body = planSchema.parse(await req.json());
  const current = await getMarketingSubscriptionPlans();
  const duplicate = current.find((plan: MarketingSubscriptionPlanRecord) => plan.slug === body.slug);
  if (duplicate) {
    return NextResponse.json({ error: "A subscription plan with this slug already exists." }, { status: 409 });
  }

  const timestamp = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    slug: body.slug,
    name: body.name,
    tagline: body.tagline ?? null,
    description: body.description ?? null,
    serviceTypes: body.serviceTypes.length > 0 ? body.serviceTypes : null,
    cadenceOptions: body.cadenceOptions.length > 0 ? body.cadenceOptions : null,
    startingPrice: body.startingPrice ?? null,
    priceLabel: body.priceLabel ?? null,
    features: body.features.length > 0 ? body.features : null,
    themeKey: body.themeKey ?? null,
    ctaLabel: body.ctaLabel ?? null,
    ctaHref: body.ctaHref ?? null,
    isPublished: body.isPublished,
    sortOrder: body.sortOrder,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await saveMarketingSubscriptionPlans([...current, created]);
  return NextResponse.json(created, { status: 201 });
}
