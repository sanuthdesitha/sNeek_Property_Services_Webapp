import { NextResponse } from "next/server";
import { propertyScopeWhere, requireClientPortal } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";
import { getDamageInvestigationForClient } from "@/lib/damage/investigation";

/**
 * D2 — the client's view of a damage report.
 *
 * Read-only, and gated three ways, all of them inside the query rather than as
 * checks after the fact (lib/damage/investigation.ts):
 *
 *   - the report must be released (`clientVisible`), which only an admin review
 *     can do;
 *   - it must belong to one of THIS client's properties;
 *   - it must not be a DRAFT.
 *
 * A report that fails any of those returns the same 404 as one that does not
 * exist. That is deliberate: a "403 Forbidden" would confirm the report is
 * real, telling one client that another client's property has damage on file.
 *
 * There is no PATCH here. Cost and release live on the admin route; the client
 * acknowledgement flow is D3/D4.
 */
export async function GET(_req: Request, { params }: { params: { reportId: string } }) {
  try {
    const portal = await requireClientPortal({ permission: "damage" });

    // The investigation resolver scopes by client; a scoped VA additionally
    // needs the report's property to be granted, checked up front with the
    // same 404 shape as a nonexistent report.
    if (portal.propertyIds) {
      const inScope = await db.damageReport.findFirst({
        where: { id: params.reportId, property: propertyScopeWhere(portal) },
        select: { id: true },
      });
      if (!inScope) return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const report = await getDamageInvestigationForClient({
      reportId: params.reportId,
      clientId: portal.clientId,
    });
    if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ report });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Could not load the damage report." }, { status: 400 });
  }
}
