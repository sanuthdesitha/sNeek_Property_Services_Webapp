import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadCleanerSuggestions } from "@/lib/jobs/cleaner-suggestions-load";

/**
 * GET /api/admin/jobs/:id/cleaner-suggestions — ranked cleaners for an
 * unassigned job with the reasons for each (availability, clashes, cleans at
 * this property). Read-only: assigning still goes through the job's existing
 * assign route.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const result = await loadCleanerSuggestions(params.id);
    if (result.kind === "not_found") return NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not load suggestions." : message }, { status });
  }
}
