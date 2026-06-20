import { NextRequest, NextResponse } from "next/server";
import { JobStatus, QaAssignmentStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";

const QA_ROLES = [Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN] as const;

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([...QA_ROLES]);
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get("scope") ?? "active";
    const completed = scope === "completed";

    const assignments = await db.qaAssignment.findMany({
      where: completed
        ? { status: QaAssignmentStatus.COMPLETED }
        : {
            status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS] },
            OR: [{ assignedToId: null }, { assignedToId: session.user.id }, { pickedUpById: session.user.id }],
          },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        pickedUpBy: { select: { id: true, name: true, email: true } },
        job: {
          include: {
            property: { select: { name: true, address: true, suburb: true } },
            assignments: {
              where: { removedAt: null },
              select: { user: { select: { id: true, name: true, email: true } } },
            },
            formSubmissions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true } },
            qaReviews: { orderBy: { createdAt: "desc" }, take: 1 },
          },
        },
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
      take: 100,
    });

    const assignedJobIds = new Set(assignments.map((assignment) => assignment.jobId));
    const unassignedJobs = completed
      ? []
      : await db.job.findMany({
          where: {
            id: { notIn: Array.from(assignedJobIds) },
            status: { in: [JobStatus.SUBMITTED, JobStatus.QA_REVIEW] },
            // Only surface jobs that still NEED a QA review. Once a job has been
            // inspected (a completed QA assignment or a real QA-inspection review)
            // it must drop out of the queue — even on a fail, where the job stays
            // in QA_REVIEW and the fix is handled by a separate rework job.
            AND: [
              { qaAssignments: { none: { status: QaAssignmentStatus.COMPLETED } } },
              { qaReviews: { none: { kind: "QA" } } },
            ],
          },
          include: {
            property: { select: { name: true, address: true, suburb: true } },
            assignments: {
              where: { removedAt: null },
              select: { user: { select: { id: true, name: true, email: true } } },
            },
            formSubmissions: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, createdAt: true } },
            qaReviews: { orderBy: { createdAt: "desc" }, take: 1 },
          },
          orderBy: [{ scheduledDate: "asc" }, { dueTime: "asc" }],
          take: 100,
        });

    return NextResponse.json({ assignments, unassignedJobs });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
