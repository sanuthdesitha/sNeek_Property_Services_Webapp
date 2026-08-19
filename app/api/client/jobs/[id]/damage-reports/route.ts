import { NextResponse } from "next/server";
import { DamageReportStatus, Role } from "@prisma/client";
import { propertyScopeWhere, requireClientPortal } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";
import { highestDamageSeverity } from "@/lib/damage/severity";

/**
 * D4 — the damage reports on one job that this client is allowed to see.
 *
 * The gate is the same one the investigation read uses, expressed in the query
 * rather than checked afterwards: released (`clientVisible`), not a DRAFT, and
 * on a property belonging to THIS client. A report failing any of those is
 * simply absent from the list — the client is never told it exists.
 *
 * No costs here, and none in the summary shape at all: repair cost is an
 * internal figure (see lib/damage/investigation.ts), so it is not selected
 * rather than selected-and-dropped.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    // Chokepoint with the "damage" grant — this is exactly the capability the
    // key describes: viewing released damage reports.
    const portal = await requireClientPortal({ permission: "damage" });

    const reports = await db.damageReport.findMany({
      where: {
        jobId: params.id,
        clientVisible: true,
        status: {
          in: [
            DamageReportStatus.SUBMITTED,
            DamageReportStatus.UNDER_REVIEW,
            DamageReportStatus.CLOSED,
          ],
        },
        property: propertyScopeWhere(portal),
      },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        items: { select: { severity: true } },
      },
    });

    return NextResponse.json({
      reports: reports.map((report) => ({
        id: report.id,
        status: report.status,
        submittedAt: report.submittedAt,
        itemCount: report.items.length,
        highestSeverity: highestDamageSeverity(report.items.map((item) => item.severity)),
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Could not load damage reports." }, { status: 400 });
  }
}
