import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { FEATURE_DEFS, sanitizeFeatures } from "@/lib/checklists/features";

/**
 * Public (token-gated) amenities survey for a property. The client ticks the
 * amenities their property has; the answers are written to Property.features
 * and the checklist profile is flagged for admin re-review. Read-only property
 * exposure is limited to the property NAME — no address/access data.
 */

async function resolveToken(token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const row = await db.appSetting.findUnique({ where: { key: `amenitiesSurvey:${token}` } });
  const value = row?.value && typeof row.value === "object" && !Array.isArray(row.value)
    ? (row.value as Record<string, unknown>)
    : null;
  if (!value || typeof value.propertyId !== "string") return null;
  const expiresAt = typeof value.expiresAt === "string" ? new Date(value.expiresAt) : null;
  if (!expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) return null;
  return { propertyId: value.propertyId, submittedAt: typeof value.submittedAt === "string" ? value.submittedAt : null, key: row!.key, value };
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const resolved = await resolveToken(params.token);
  if (!resolved) return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });
  const property = await db.property.findUnique({
    where: { id: resolved.propertyId },
    select: { name: true, bedrooms: true, bathrooms: true, hasBalcony: true, features: true },
  });
  if (!property) return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });
  return NextResponse.json({
    propertyName: property.name,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    hasBalcony: property.hasBalcony,
    features: sanitizeFeatures(property.features),
    featureDefs: FEATURE_DEFS.map((f) => ({ key: f.key, label: f.label, group: f.group })),
    alreadySubmitted: Boolean(resolved.submittedAt),
  });
}

const submitSchema = z.object({
  features: z.record(z.string(), z.boolean()),
  bedrooms: z.number().int().min(0).max(30).optional(),
  bathrooms: z.number().int().min(0).max(30).optional(),
  hasBalcony: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const resolved = await resolveToken(params.token);
    if (!resolved) return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 404 });
    const body = submitSchema.parse(await req.json());

    await db.property.update({
      where: { id: resolved.propertyId },
      data: {
        features: sanitizeFeatures(body.features) as Prisma.InputJsonValue,
        ...(body.bedrooms != null ? { bedrooms: body.bedrooms } : {}),
        ...(body.bathrooms != null ? { bathrooms: body.bathrooms } : {}),
        ...(body.hasBalcony != null ? { hasBalcony: body.hasBalcony } : {}),
      },
    });
    // Flag any existing profile for re-review — the amenities just changed.
    await db.propertyChecklistProfile.updateMany({
      where: { propertyId: resolved.propertyId },
      data: { status: "STALE" },
    });
    // Record submission on the token (kept until expiry so the client can fix a mistake).
    await db.appSetting.update({
      where: { key: resolved.key },
      data: { value: { ...resolved.value, submittedAt: new Date().toISOString() } as any },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not save." }, { status: 400 });
  }
}
