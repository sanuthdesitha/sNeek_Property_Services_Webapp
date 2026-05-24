import { NextResponse } from "next/server";
import { QaAssignmentStatus, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";

const QA_ROLES = [Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN] as const;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([...QA_ROLES]);
    const existing = await db.qaAssignment.findFirst({
      where: {
        jobId: params.id,
        status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS] },
        OR: [{ assignedToId: null }, { assignedToId: session.user.id }, { pickedUpById: session.user.id }],
      },
      orderBy: { createdAt: "asc" },
    });
    const assignment = existing
      ? await db.qaAssignment.update({
          where: { id: existing.id },
          data: {
            status: QaAssignmentStatus.IN_PROGRESS,
            pickedUpById: session.user.id,
            pickedUpAt: existing.pickedUpAt ?? new Date(),
          },
        })
      : await db.qaAssignment.create({
          data: {
            jobId: params.id,
            status: QaAssignmentStatus.IN_PROGRESS,
            pickedUpById: session.user.id,
            pickedUpAt: new Date(),
          },
        });
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "QA_ASSIGNMENT_PICKUP",
        entity: "QaAssignment",
        entityId: assignment.id,
        after: assignment as any,
      },
    });
    return NextResponse.json(assignment);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
