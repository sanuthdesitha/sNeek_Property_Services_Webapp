import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  accessGuideSaveSchema,
  cleanAccessGuideForSave,
  sanitizeAccessGuide,
} from "@/lib/properties/access-guide";

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

// The kinds list, entry schema and sanitiser live in lib/properties/access-guide
// so this route, the cleaner route and both editors cannot drift apart.

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
      accessGuide: sanitizeAccessGuide(property.accessGuide),
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = accessGuideSaveSchema.parse(await req.json());
    const property = await db.property.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });

    // Strip empty-image captions and drop entries that carry no useful content.
    const cleaned = cleanAccessGuideForSave(body.accessGuide);

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
