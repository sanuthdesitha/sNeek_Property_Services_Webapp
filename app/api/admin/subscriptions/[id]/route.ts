import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { marketedJobTypeSchema } from "@/lib/marketing/job-types";
import { getMarketingSubscriptionPlans, saveMarketingSubscriptionPlans, type MarketingSubscriptionPlanRecord } from "@/lib/marketing/store";

const planSchema = z.object({
  slug: z.string().trim().min(2).max(80).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  tagline: z.string().trim().max(160).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  serviceTypes: z.array(marketedJobTypeSchema).optional(),
  cadenceOptions: z.array(z.string().trim().min(1).max(50)).optional(),
  startingPrice: z.number().min(0).max(100000).optional().nullable(),
  priceLabel: z.string().trim().max(120).optional().nullable(),
  features: z.array(z.string().trim().min(1).max(160)).optional(),
  themeKey: z.string().trim().max(50).optional().nullable(),
  ctaLabel: z.string().trim().max(80).optional().nullable(),
  ctaHref: z.string().trim().max(240).optional().nullable(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN]);
  const body = planSchema.parse(await req.json());
  const current = await getMarketingSubscriptionPlans();
  const index = current.findIndex((plan: MarketingSubscriptionPlanRecord) => plan.id === params.id);
  if (index < 0) {
    return NextResponse.json({ error: "Subscription plan not found." }, { status: 404 });
  }

  const updated = {
    ...current[index],
    slug: body.slug ?? current[index].slug,
    name: body.name ?? current[index].name,
    tagline: body.tagline === undefined ? current[index].tagline : body.tagline,
    description: body.description === undefined ? current[index].description : body.description,
    serviceTypes: body.serviceTypes === undefined ? current[index].serviceTypes : body.serviceTypes.length > 0 ? body.serviceTypes : null,
    cadenceOptions: body.cadenceOptions === undefined ? current[index].cadenceOptions : body.cadenceOptions.length > 0 ? body.cadenceOptions : null,
    startingPrice: body.startingPrice === undefined ? current[index].startingPrice : body.startingPrice,
    priceLabel: body.priceLabel === undefined ? current[index].priceLabel : body.priceLabel,
    features: body.features === undefined ? current[index].features : body.features.length > 0 ? body.features : null,
    themeKey: body.themeKey === undefined ? current[index].themeKey : body.themeKey,
    ctaLabel: body.ctaLabel === undefined ? current[index].ctaLabel : body.ctaLabel,
    ctaHref: body.ctaHref === undefined ? current[index].ctaHref : body.ctaHref,
    isPublished: body.isPublished ?? current[index].isPublished,
    sortOrder: body.sortOrder ?? current[index].sortOrder,
    updatedAt: new Date().toISOString(),
  };

  const duplicate = current.find((plan: MarketingSubscriptionPlanRecord) => plan.id !== params.id && plan.slug === updated.slug);
  if (duplicate) {
    return NextResponse.json({ error: "A subscription plan with this slug already exists." }, { status: 409 });
  }

  const next = [...current];
  next[index] = updated;
  await saveMarketingSubscriptionPlans(next);
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN]);
  const current = await getMarketingSubscriptionPlans();
  if (!current.some((plan: MarketingSubscriptionPlanRecord) => plan.id === params.id)) {
    return NextResponse.json({ error: "Subscription plan not found." }, { status: 404 });
  }
  await saveMarketingSubscriptionPlans(current.filter((plan: MarketingSubscriptionPlanRecord) => plan.id !== params.id));
  return NextResponse.json({ ok: true });
}
