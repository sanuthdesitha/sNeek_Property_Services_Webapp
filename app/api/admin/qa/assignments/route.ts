import { NextRequest, NextResponse } from "next/server";
import { QaAssignmentStatus, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";

const bodySchema = z.object({
  jobIds: z.array(z.string().trim().min(1)).min(1).max(100),
  assignedToId: z.string().trim().min(1).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json());
    if (body.assignedToId) {
      const user = await db.user.findUnique({
        where: { id: body.assignedToId },
        select: { role: true, isActive: true },
      });
      if (!user?.isActive || (user.role !== Role.QA_INSPECTOR && user.role !== Role.OPS_MANAGER)) {
        return NextResponse.json({ error: "Assign QA to an active QA inspector or OPS manager." }, { status: 400 });
      }
    }

    const rows = [];
    for (const jobId of body.jobIds) {
      rows.push(
        await db.qaAssignment.create({
          data: {
            jobId,
            assignedToId: body.assignedToId ?? null,
            createdById: session.user.id,
            status: body.assignedToId ? QaAssignmentStatus.ASSIGNED : QaAssignmentStatus.OPEN,
            dueAt: body.dueAt ? new Date(body.dueAt) : null,
            notes: body.notes || null,
          },
        })
      );
    }

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "QA_ASSIGNMENT_CREATE",
        entity: "QaAssignment",
        entityId: rows.map((row) => row.id).join(","),
        after: { jobIds: body.jobIds, assignedToId: body.assignedToId ?? null } as any,
      },
    });

    return NextResponse.json({ created: rows.length, assignments: rows });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
