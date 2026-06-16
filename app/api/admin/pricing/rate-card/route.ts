import { NextRequest, NextResponse } from "next/server";
import { JobType, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import {
  LABOUR_HOURS,
  RATE_CARD_JOB_TYPES,
  computeRateCard,
  estimateLabourHours,
  impliedMargin,
  priceForHours,
} from "@/lib/pricing/rate-card";

const CONDITION_MULTIPLIERS = { light: 0.94, standard: 1, heavy: 1.18 };
const FREQUENCY_MULTIPLIERS = { one_off: 1, weekly: 0.92, fortnightly: 0.95, monthly: 0.97 };

// ─── GET: current rate card + computed preview + pricing settings ──────────────
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getAppSettings();
    const { cleanerHourlyCost, rackHourlyRate, marginFloorPercent, gstEnabled } = settings.pricing;

    const rows = await db.priceBook.findMany({
      where: { jobType: { in: RATE_CARD_JOB_TYPES }, isActive: true },
      orderBy: [{ jobType: "asc" }, { bedrooms: "asc" }, { bathrooms: "asc" }],
      select: { id: true, jobType: true, bedrooms: true, bathrooms: true, baseRate: true },
    });

    const saved = rows.map((r) => {
      const hours = estimateLabourHours(String(r.jobType), r.bedrooms ?? 0, r.bathrooms ?? 0);
      return {
        ...r,
        label: LABOUR_HOURS[String(r.jobType)]?.label ?? String(r.jobType),
        hours,
        margin: impliedMargin(r.baseRate, hours, cleanerHourlyCost),
      };
    });

    return NextResponse.json({
      pricing: { cleanerHourlyCost, rackHourlyRate, marginFloorPercent, gstEnabled },
      rows: saved,
      preview: computeRateCard(rackHourlyRate).map((r) => ({
        ...r,
        margin: impliedMargin(r.baseRate, r.hours, cleanerHourlyCost),
      })),
      seeded: rows.length > 0,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed to load rate card." }, { status });
  }
}

// ─── POST: (re)generate the rate card from the current rack rate ───────────────
export async function POST() {
  try {
    const session = await requireRole([Role.ADMIN]);
    const settings = await getAppSettings();
    const rack = settings.pricing.rackHourlyRate;
    const card = computeRateCard(rack);

    for (const row of card) {
      const m = LABOUR_HOURS[String(row.jobType)];
      const additionalBedroom = priceForHours(m.perBed, rack, 0);
      const additionalBathroom = priceForHours(m.perBath, rack, 0);
      await db.priceBook.upsert({
        where: {
          jobType_bedrooms_bathrooms: {
            jobType: row.jobType as JobType,
            bedrooms: row.bedrooms,
            bathrooms: row.bathrooms,
          },
        },
        create: {
          jobType: row.jobType as JobType,
          bedrooms: row.bedrooms,
          bathrooms: row.bathrooms,
          baseRate: row.baseRate,
          pricingModel: "rate-card",
          pricingVariables: { hours: row.hours, rackHourlyRate: rack },
          addOns: { additionalBedroom, additionalBathroom },
          multipliers: { conditionLevel: CONDITION_MULTIPLIERS, frequency: FREQUENCY_MULTIPLIERS },
          isActive: true,
        },
        update: {
          baseRate: row.baseRate,
          pricingModel: "rate-card",
          pricingVariables: { hours: row.hours, rackHourlyRate: rack },
          addOns: { additionalBedroom, additionalBathroom },
          multipliers: { conditionLevel: CONDITION_MULTIPLIERS, frequency: FREQUENCY_MULTIPLIERS },
          isActive: true,
        },
      });
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "REGENERATE_RATE_CARD",
        entity: "PriceBook",
        entityId: "rate-card",
        after: { rows: card.length, rackHourlyRate: rack } as any,
      },
    });

    return NextResponse.json({ ok: true, generated: card.length });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not generate rate card." }, { status });
  }
}

// ─── PATCH: manual override of a single base rate ──────────────────────────────
const patchSchema = z.object({ id: z.string().min(1), baseRate: z.number().min(0).max(100000) });

export async function PATCH(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = patchSchema.parse(await req.json());
    const updated = await db.priceBook.update({
      where: { id: body.id },
      data: { baseRate: body.baseRate },
      select: { id: true, baseRate: true },
    });
    return NextResponse.json({ ok: true, ...updated });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update price." }, { status });
  }
}
