import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadPropertyPreview } from "@/lib/properties/preview";

/** GET — the Properties list side panel for one active property (ADMIN / OPS_MANAGER). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const preview = await loadPropertyPreview(params.id);
    if (!preview) return NextResponse.json({ error: "Property not found or archived." }, { status: 404 });
    return NextResponse.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load the property.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not load the property." : message }, { status });
  }
}
