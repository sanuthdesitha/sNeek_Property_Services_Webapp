import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createJobSchema } from "@/lib/validations/job";
import { Role } from "@prisma/client";
import { applyJobTimingRules, serializeJobInternalNotes } from "@/lib/jobs/meta";
import { classifyPriorityFromTimingRule } from "@/lib/jobs/priority";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import { ensureServiceSiteProperty } from "@/lib/jobs/service-site";
import { getValidationErrorMessage } from "@/lib/validations/errors";
import { attachPendingCarryForwardTasksToJob } from "@/lib/job-tasks/service";
import { assignPreferredCleanerIfAvailable } from "@/lib/jobs/preferred-cleaner";

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
      propertyId,
      clientId,
      startTime,
      dueTime,
      internalNotes,
      isDraft,
      tags,
      attachments,
      transportAllowances,
      earlyCheckin,
      lateCheckout,
      serviceSite,
      serviceContext,
      reservationContext,
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
    const priority = classifyPriorityFromTimingRule(normalizedEarlyCheckin);
    const jobNumber = await reserveJobNumber(db);
    const resolvedPropertyId =
      propertyId ??
      (
        await ensureServiceSiteProperty(db, {
          clientId,
          jobType: body.jobType,
          estimatedHours: body.estimatedHours,
          serviceSite: serviceSite!,
          serviceContext,
        })
      ).id;
    const job = await db.job.create({
      data: {
        ...rest,
        propertyId: resolvedPropertyId,
        jobNumber,
        startTime: timing.startTime,
        dueTime: timing.dueTime,
        priorityBucket: priority.priorityBucket,
        priorityReason: priority.priorityReason,
        sameDayCheckin: priority.sameDayCheckin,
        sameDayCheckinTime: priority.sameDayCheckinTime,
        scheduledDate: new Date(body.scheduledDate),
        internalNotes: serializeJobInternalNotes({
          internalNoteText: internalNotes ?? "",
          isDraft,
          tags,
        attachments,
        transportAllowances,
        earlyCheckin: normalizedEarlyCheckin,
        lateCheckout: normalizedLateCheckout,
        serviceContext,
        reservationContext,
      }),
    },
      include: { property: true },
    });
    await attachPendingCarryForwardTasksToJob({
      jobId: job.id,
      propertyId: job.propertyId,
      scheduledDate: job.scheduledDate,
      startTime: job.startTime,
    });
    await assignPreferredCleanerIfAvailable({
      jobId: job.id,
      propertyId: job.propertyId,
      jobType: job.jobType,
    });
    return NextResponse.json(job, { status: 201 });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: getValidationErrorMessage(err, "Could not create job.") }, { status });
  }
}
