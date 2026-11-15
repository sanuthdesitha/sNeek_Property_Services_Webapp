import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { loadAssignFacts } from "@/lib/jobs/assign-facts-load";
import { ASSIGN_FACTS_MAX_JOBS } from "@/lib/jobs/assign-facts-types";

/**
 * GET /api/admin/jobs/assign-facts?jobIds=a,b — read only. Leave, expired
 * police check / visa and other work that day for every active cleaner, so the
 * assign dialog shows them before Save. Assigning still goes through
 * /api/admin/jobs/:id/assign or /api/admin/jobs/bulk-assign, which re-check
 * and answer 409 with "Assign anyway" exactly as before.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const jobIds = (req.nextUrl.searchParams.get("jobIds") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
    if (jobIds.length === 0 || jobIds.length > ASSIGN_FACTS_MAX_JOBS) {
      return NextResponse.json({ error: `Send between 1 and ${ASSIGN_FACTS_MAX_JOBS} job ids.` }, { status: 400 });
    }
    const facts = await loadAssignFacts(jobIds);
    if (!facts) return NextResponse.json({ error: "One or more jobs were not found." }, { status: 404 });
    return NextResponse.json(facts, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not load the cleaners' leave and documents." : message }, { status });
  }
}
