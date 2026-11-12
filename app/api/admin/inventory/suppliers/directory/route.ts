import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadSupplierDirectory } from "@/lib/laundry/partners";

/**
 * GET /api/admin/inventory/suppliers/directory — the Suppliers list: stock
 * suppliers and laundry partners together (lib/suppliers/directory-types.ts),
 * plus the LAUNDRY portal accounts the partner editor can put on a team.
 * ADMIN and OPS_MANAGER, like both supplier lists it reads.
 */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await loadSupplierDirectory(), { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Could not load suppliers." }, { status });
  }
}
