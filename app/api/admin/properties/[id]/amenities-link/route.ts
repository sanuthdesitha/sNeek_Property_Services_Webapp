import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { resolveAppUrl } from "@/lib/app-url";

const TOKEN_TTL_DAYS = 14;

/**
 * POST — mint a shareable client-facing amenities survey link for a property.
 * The client ticks what the property has (dishwasher, oven, pool, ...) and the
 * answers land in Property.features for the admin to review/approve the
 * checklist. Token is stored in AppSetting (no schema change), 14-day expiry.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const property = await db.property.findUnique({
      where: { id: params.id },
      select: { id: true, name: true },
    });
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    await db.appSetting.create({
      data: {
        key: `amenitiesSurvey:${token}`,
        value: {
          propertyId: property.id,
          createdById: session.user.id,
          createdAt: new Date().toISOString(),
          expiresAt: expiresAt.toISOString(),
        } as any,
      },
    });

    const url = resolveAppUrl(`/amenities/${token}`, req);
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "AMENITIES_LINK_CREATE",
        entity: "Property",
        entityId: property.id,
        after: { expiresAt: expiresAt.toISOString() } as any,
      },
    });
    return NextResponse.json({ url, expiresAt });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
