import { NextRequest, NextResponse } from "next/server";
import { QaAssignmentStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

const QA_ROLES = [Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN] as const;

const bodySchema = z.object({ action: z.enum(["start", "pause"]) });

/**
 * Persist the QA on-site stopwatch on the QaAssignment so it survives tab
 * switches, navigation and refresh (the client clock alone pauses when the tab
 * is backgrounded). `onSiteStartedAt` marks the running segment's start;
 * `onSiteMinutes` accumulates paused time. Elapsed = onSiteMinutes + (now - start).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([...QA_ROLES]);
    const { action } = bodySchema.parse(await req.json());

    let assignment = await db.qaAssignment.findFirst({
      where: {
        jobId: params.id,
        status: { in: [QaAssignmentStatus.OPEN, QaAssignmentStatus.ASSIGNED, QaAssignmentStatus.IN_PROGRESS] },
        OR: [{ assignedToId: null }, { assignedToId: session.user.id }, { pickedUpById: session.user.id }],
      },
      orderBy: { createdAt: "desc" },
    });
    // No assignment yet (job opened directly, e.g. admin ad-hoc review): a
    // start must still be recorded, so attach an assignment to this inspector
    // (mirrors pickup/route.ts). A pause with nothing to pause stays local.
    if (!assignment) {
      if (action !== "start") return NextResponse.json({ persisted: false });
      const job = await db.job.findUnique({ where: { id: params.id }, select: { id: true } });
      if (!job) return NextResponse.json({ error: "QA job not found." }, { status: 404 });
      assignment = await db.qaAssignment.create({
        data: {
          jobId: params.id,
          status: QaAssignmentStatus.IN_PROGRESS,
          pickedUpById: session.user.id,
          pickedUpAt: new Date(),
        },
      });
    }

    if (action === "start") {
      if (!assignment.onSiteStartedAt) {
        const updated = await db.qaAssignment.update({
          where: { id: assignment.id },
          data: {
            onSiteStartedAt: new Date(),
            onSiteEndedAt: null,
            status: QaAssignmentStatus.IN_PROGRESS,
            pickedUpById: assignment.pickedUpById ?? session.user.id,
            pickedUpAt: assignment.pickedUpAt ?? new Date(),
          },
        });
        return NextResponse.json({
          persisted: true,
          onSiteStartedAt: updated.onSiteStartedAt,
          onSiteMinutes: updated.onSiteMinutes ?? 0,
        });
      }
      return NextResponse.json({
        persisted: true,
        onSiteStartedAt: assignment.onSiteStartedAt,
        onSiteMinutes: assignment.onSiteMinutes ?? 0,
      });
    }

    // pause → fold the running segment into the accumulated minutes.
    let minutes = assignment.onSiteMinutes ?? 0;
    if (assignment.onSiteStartedAt) {
      const segment = Math.max(0, Math.round((Date.now() - assignment.onSiteStartedAt.getTime()) / 60_000));
      minutes += segment;
    }
    const updated = await db.qaAssignment.update({
      where: { id: assignment.id },
      data: { onSiteStartedAt: null, onSiteMinutes: minutes },
    });
    return NextResponse.json({
      persisted: true,
      onSiteStartedAt: null,
      onSiteMinutes: updated.onSiteMinutes ?? minutes,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
