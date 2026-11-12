import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { propertyBulkSchema } from "@/lib/properties/bulk-types";
import { PropertyBulkError, runPropertyBulk } from "@/lib/properties/bulk";

/**
 * POST — Properties bulk actions (set laundry partner, assign checklist, sync
 * calendars) for ADMIN / OPS_MANAGER, the same roles and operations pack
 * (properties) as each single-property route. Answers `{ results }` with one
 * outcome per property.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const request = propertyBulkSchema.parse(await req.json().catch(() => null));
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
    const results = await runPropertyBulk(request, session.user.id, ipAddress);
    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid bulk request." }, { status: 400 });
    }
    if (err instanceof PropertyBulkError) return NextResponse.json({ error: err.message }, { status: 400 });
    const message = err instanceof Error ? err.message : "Bulk action failed.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Bulk action failed." : message }, { status });
  }
}
