import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { mintAmenitiesLink } from "@/lib/checklists/amenities-links";

/**
 * POST — mint a shareable client-facing amenities survey link for a property.
 * The client ticks what the property has (dishwasher, oven, pool, ...) and the
 * answers land in Property.features for the admin to review/approve the
 * checklist. Token is stored in AppSetting (no schema change), 14-day expiry.
 * "Email it to the client" sends this link: POST ./email.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const property = await db.property.findUnique({
      where: { id: params.id },
      select: { id: true, name: true },
    });
    if (!property) return NextResponse.json({ error: "Property not found." }, { status: 404 });
    const link = await mintAmenitiesLink(property.id, session.user.id, req);
    return NextResponse.json({ url: link.url, expiresAt: link.expiresAt });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
