import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { parseJobInternalNotes } from "@/lib/jobs/meta";
import { buildCadenceLedger } from "@/lib/properties/cadence-ledger";
/** Review only: no tasks, jobs, schedules, invoices or settings are written. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const jobs = await db.job.findMany({
      where: { propertyId: params.id, status: { in: ["COMPLETED", "INVOICED"] }, completedAt: { lte: new Date() }, isRework: false },
      orderBy: { completedAt: "desc" }, take: 500,
      select: { id: true, jobType: true, status: true, completedAt: true, internalNotes: true,
        formSubmissions: { select: { data: true, media: { where: { mediaType: { in: ["PHOTO", "VIDEO"] } }, select: { s3Key: true } } } },
        jobTasks: { where: { executionStatus: "COMPLETED" }, select: { title: true, executionStatus: true, attachments: { where: { kind: "COMPLETION_PROOF" }, select: { kind: true, s3Key: true } } } },
      },
    });
    return NextResponse.json({ rows: buildCadenceLedger(jobs.filter(job => !parseJobInternalNotes(job.internalNotes).isDraft)), reviewedJobs: jobs.length, limited: jobs.length === 500 });
  } catch (error: any) {
    const status = error.message === "UNAUTHORIZED" ? 401 : error.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: "Could not load the cadence evidence ledger." }, { status });
  }
}
