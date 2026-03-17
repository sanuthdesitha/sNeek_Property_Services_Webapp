import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createJobSchema } from "@/lib/validations/job";
import { Role } from "@prisma/client";
import { applyJobTimingRules, serializeJobInternalNotes } from "@/lib/jobs/meta";

function normalizeRule(
  rule:
    | {
        enabled?: boolean;
        preset?: "none" | "11:00" | "12:30" | "custom";
        time?: string;
      }
    | undefined
) {
  if (!rule) return undefined;
  return {
    enabled: rule.enabled === true,
    preset: rule.preset ?? "none",
    time: rule.time,
  };
}

export async function POST(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createJobSchema.parse(await req.json());
    const {
      startTime,
      dueTime,
      internalNotes,
      isDraft,
      tags,
      attachments,
      transportAllowances,
      earlyCheckin,
      lateCheckout,
      ...rest
    } = body;
    const normalizedEarlyCheckin = normalizeRule(earlyCheckin) ?? { enabled: false, preset: "none" as const };
    const normalizedLateCheckout = normalizeRule(lateCheckout) ?? { enabled: false, preset: "none" as const };
    const timing = applyJobTimingRules({
      startTime,
      dueTime,
      earlyCheckin: normalizedEarlyCheckin,
      lateCheckout: normalizedLateCheckout,
    });
    const job = await db.job.create({
      data: {
        ...rest,
        startTime: timing.startTime,
        dueTime: timing.dueTime,
        scheduledDate: new Date(body.scheduledDate),
        internalNotes: serializeJobInternalNotes({
          internalNoteText: internalNotes ?? "",
          isDraft,
          tags,
          attachments,
          transportAllowances,
          earlyCheckin: normalizedEarlyCheckin,
          lateCheckout: normalizedLateCheckout,
        }),
      },
      include: { property: true },
    });
    return NextResponse.json(job, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
