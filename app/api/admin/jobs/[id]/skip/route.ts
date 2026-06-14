import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

// Best-effort: push an in-app notification to the client's portal users.
async function notifyClientOfSkipDecision(jobId: string, approved: boolean) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      property: {
        select: {
          name: true,
          client: {
            select: {
              users: {
                where: { role: Role.CLIENT, isActive: true },
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });
  const recipients = job?.property?.client?.users ?? [];
  if (recipients.length === 0) return;
  const propertyName = job?.property?.name ?? "your property";
  await db.notification.createMany({
    data: recipients.map((user) => ({
      userId: user.id,
      jobId,
      channel: NotificationChannel.PUSH,
      subject: approved ? "Clean skipped" : "Skip request declined",
      body: approved
        ? `Your request to skip the clean at ${propertyName} was approved — this turnover will not be cleaned.`
        : `Your request to skip the clean at ${propertyName} was declined — the clean will go ahead as scheduled.`,
      status: NotificationStatus.SENT,
      sentAt: new Date(),
    })),
  });
}

// Admin/ops control over the "skip / don't clean" state machine.
//   action=set      → cleanSkipStatus=SKIPPED          (admin decides directly)
//   action=approve  → REQUESTED → SKIPPED              (grant a client request)
//   action=decline  → REQUESTED → DECLINED             (refuse a client request)
//   action=unskip   → SKIPPED/DECLINED/REQUESTED → NONE (restore the clean)
const schema = z.object({
  action: z.enum(["set", "approve", "decline", "unskip"]),
  reason: z.string().trim().max(500).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        cleanSkipStatus: true,
        cleanSkipReason: true,
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    let nextStatus: "NONE" | "REQUESTED" | "SKIPPED" | "DECLINED";
    switch (body.action) {
      case "set":
        nextStatus = "SKIPPED";
        break;
      case "approve":
        if (job.cleanSkipStatus !== "REQUESTED") {
          return NextResponse.json(
            { error: "There is no pending skip request to approve." },
            { status: 400 }
          );
        }
        nextStatus = "SKIPPED";
        break;
      case "decline":
        if (job.cleanSkipStatus !== "REQUESTED") {
          return NextResponse.json(
            { error: "There is no pending skip request to decline." },
            { status: 400 }
          );
        }
        nextStatus = "DECLINED";
        break;
      case "unskip":
        nextStatus = "NONE";
        break;
      default:
        nextStatus = "NONE";
    }

    const updated = await db.job.update({
      where: { id: job.id },
      data: {
        cleanSkipStatus: nextStatus,
        // Preserve the client's reason on approve/decline; allow an admin reason otherwise.
        cleanSkipReason:
          nextStatus === "NONE"
            ? null
            : body.reason?.trim() || job.cleanSkipReason || null,
        cleanSkipDecidedById: nextStatus === "NONE" ? null : session.user.id,
        cleanSkipAt: new Date(),
        ...(body.action === "set" ? { cleanSkipRequestedById: null } : {}),
        ...(nextStatus === "NONE"
          ? { cleanSkipRequestedById: null, cleanSkipDecidedById: null }
          : {}),
      },
      select: {
        id: true,
        cleanSkipStatus: true,
        cleanSkipReason: true,
        cleanSkipAt: true,
        cleanSkipRequestedById: true,
        cleanSkipDecidedById: true,
      },
    });

    // Best-effort: notify the client of the decision on an approve/decline.
    if (body.action === "approve" || body.action === "decline") {
      try {
        await notifyClientOfSkipDecision(job.id, body.action === "approve");
      } catch {
        // ignore notification failures
      }
    }

    return NextResponse.json({ ok: true, ...updated });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not update skip state." }, { status });
  }
}
