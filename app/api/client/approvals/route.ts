import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { clientApprovalVersion } from "@/lib/commercial/client-approvals";
import { listApprovalsForViewer, resolveApprovalViewer } from "@/lib/commercial/client-approval-access";

export async function GET() {
  try {
    const session = await requireRole([Role.CLIENT]);
    const viewer = await resolveApprovalViewer(session.user.id);
    if (!viewer) {
      return NextResponse.json([], { status: 200 });
    }
    const rows = await listApprovalsForViewer(viewer);

    const propertyIds = Array.from(
      new Set(rows.map((row) => row.propertyId).filter((value): value is string => Boolean(value)))
    );
    const jobIds = Array.from(
      new Set(rows.map((row) => row.jobId).filter((value): value is string => Boolean(value)))
    );

    const [properties, jobs] = await Promise.all([
      propertyIds.length
        ? db.property.findMany({
            where: { id: { in: propertyIds } },
            select: { id: true, name: true, suburb: true },
          })
        : Promise.resolve([]),
      jobIds.length
        ? db.job.findMany({
            where: { id: { in: jobIds } },
            select: {
              id: true,
              jobType: true,
              scheduledDate: true,
              property: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const propertyById = new Map(properties.map((row) => [row.id, row]));
    const jobById = new Map(jobs.map((row) => [row.id, row]));

    return NextResponse.json(
      rows.map((row) => ({
        ...row,
        version: clientApprovalVersion(row),
        property: row.propertyId ? propertyById.get(row.propertyId) ?? null : null,
        job: row.jobId ? jobById.get(row.jobId) ?? null : null,
      }))
    );
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}
