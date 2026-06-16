import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { SERVICE_CATALOG } from "@/lib/pricing/service-catalog";
import { getServicePricing, saveServiceRate } from "@/lib/pricing/service-pricing-store";

// ─── GET: every service with its model, fields, and current (editable) rate ────
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [pricing, settings] = await Promise.all([getServicePricing(), getAppSettings()]);
    const services = SERVICE_CATALOG.map((c) => ({
      jobType: c.jobType,
      label: c.label,
      model: c.model,
      itemLabel: c.itemLabel ?? null,
      unitLabel: c.unitLabel ?? null,
      rate: pricing[c.jobType] ?? c.rate,
    }));
    return NextResponse.json({ services, gstEnabled: settings.pricing.gstEnabled });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Failed to load service pricing." }, { status });
  }
}

// ─── PATCH: save the rate for one service ──────────────────────────────────────
const bandSchema = z.object({ label: z.string().trim().min(1).max(80), price: z.number().min(0).max(100000) });
const rateSchema = z.object({
  base: z.number().min(0).max(100000).optional(),
  perBedroom: z.number().min(0).max(100000).optional(),
  perBathroom: z.number().min(0).max(100000).optional(),
  perSqm: z.number().min(0).max(10000).optional(),
  perWindow: z.number().min(0).max(10000).optional(),
  perItem: z.number().min(0).max(100000).optional(),
  hourly: z.number().min(0).max(10000).optional(),
  bands: z.array(bandSchema).max(12).optional(),
  minCharge: z.number().min(0).max(100000),
});
const patchSchema = z.object({ jobType: z.string().min(1), rate: rateSchema });

export async function PATCH(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const body = patchSchema.parse(await req.json());
    const known = SERVICE_CATALOG.some((c) => c.jobType === body.jobType);
    if (!known) return NextResponse.json({ error: "Unknown service type." }, { status: 400 });
    await saveServiceRate(body.jobType, body.rate);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not save rate." }, { status });
  }
}
