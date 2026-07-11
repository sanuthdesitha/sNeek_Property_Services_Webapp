import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Rich per-property ACCESS GUIDE — an ordered array of access entries persisted
 * to `Property.accessGuide` (additive JSON, no schema change). Admin/ops manage
 * it; cleaners read it via the cleaner-scoped GET.
 *
 * Entry shape:
 *   { id, kind, label, instructions?, images: [{ url, key, caption? }] }
 *   kind ∈ LOCKBOX|KEYS|ENTRY|ALARM|PARKING|BIN_ROOM|SUPPLIES_CUPBOARD|WIFI|OTHER
 */

export const ACCESS_GUIDE_KINDS = [
  "LOCKBOX",
  "KEYS",
  "ENTRY",
  "ALARM",
  "PARKING",
  "BIN_ROOM",
  "SUPPLIES_CUPBOARD",
  "WIFI",
  "OTHER",
] as const;

const imageSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  key: z.string().trim().min(1).max(1024),
  caption: z.string().trim().max(280).optional(),
});

const entrySchema = z.object({
  id: z.string().trim().min(1).max(64),
  kind: z.enum(ACCESS_GUIDE_KINDS),
  label: z.string().trim().min(1).max(120),
  instructions: z.string().trim().max(4000).optional(),
  images: z.array(imageSchema).max(24).default([]),
});

const saveSchema = z.object({
  accessGuide: z.array(entrySchema).max(40),
});

/** Normalise stored JSON into a clean array (defensive against legacy shapes). */
function sanitizeStored(value: unknown) {
  if (!Array.isArray(value)) return [];
  const out: z.infer<typeof entrySchema>[] = [];
  for (const raw of value) {
    const parsed = entrySchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const property = await db.property.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, accessGuide: true },
    });
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });
    return NextResponse.json({
      propertyId: property.id,
      propertyName: property.name,
      accessGuide: sanitizeStored(property.accessGuide),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = saveSchema.parse(await req.json());
    const property = await db.property.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });

    // Strip empty-image captions and drop entries that carry no useful content.
    const cleaned = body.accessGuide
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        label: entry.label,
        instructions: entry.instructions?.trim() || undefined,
        images: entry.images.map((img) => ({
          url: img.url,
          key: img.key,
          caption: img.caption?.trim() || undefined,
        })),
      }))
      .filter((entry) => entry.label || entry.instructions || entry.images.length > 0);

    await db.property.update({
      where: { id: params.id },
      data: { accessGuide: cleaned as any },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PROPERTY_ACCESS_GUIDE_SAVE",
        entity: "Property",
        entityId: params.id,
        after: { entries: cleaned.length } as any,
      },
    });

    return NextResponse.json({ ok: true, accessGuide: cleaned });
  } catch (err: any) {
    if (err?.name === "ZodError") {
      return NextResponse.json({ error: "Invalid access guide data." }, { status: 400 });
    }
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
