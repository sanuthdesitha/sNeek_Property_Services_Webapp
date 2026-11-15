import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { mintAmenitiesLink } from "@/lib/checklists/amenities-links";

const bodySchema = z.object({ propertyIds: z.array(z.string().trim().min(1)).min(1).max(50) });

/**
 * POST — "Copy N client links" on Checklist coverage: one amenities survey
 * link per selected property, in one request, answered per property (made /
 * not found). Same links as the one-property route; nothing is sent.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json().catch(() => ({})));
    const found = await db.property.findMany({ where: { id: { in: body.propertyIds } }, select: { id: true, name: true } });
    const results: Array<{ propertyId: string; name: string | null; url: string | null; expiresAt: string | null; outcome: "made" | "not_found" }> = [];
    for (const id of body.propertyIds) {
      const property = found.find((row) => row.id === id);
      if (!property) {
        results.push({ propertyId: id, name: null, url: null, expiresAt: null, outcome: "not_found" });
        continue;
      }
      const link = await mintAmenitiesLink(property.id, session.user.id, req);
      results.push({ propertyId: id, name: property.name, url: link.url, expiresAt: link.expiresAt.toISOString(), outcome: "made" });
    }
    return NextResponse.json({ results });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err instanceof z.ZodError ? "Choose between 1 and 50 properties." : err.message }, { status });
  }
}
