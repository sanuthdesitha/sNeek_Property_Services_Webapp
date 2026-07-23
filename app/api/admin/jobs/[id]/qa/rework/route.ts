import { NextRequest, NextResponse } from "next/server";
import { Role, JobStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { assignPreferredCleanerIfAvailable } from "@/lib/jobs/preferred-cleaner";
import { sendLifecycleEmail } from "@/lib/notifications/lifecycle";
import { createAdminReworkJob, getAdminReworkContext } from "@/lib/qa/admin-rework";
import { logger } from "@/lib/logger";

/**
 * Creates a rework job after an admin has explicitly confirmed it.
 *
 * Split out from the QA-score route on purpose. Confirming used to mean
 * re-posting the score, which would file a SECOND QAReview and a second audit
 * row for one decision. Here the score is already saved and untouched; this
 * endpoint does one thing.
 *
 * Everything the confirmation implies happens together: the job, the preferred
 * cleaner, and the two client emails (we found something / here is the
 * re-clean). Those emails are exactly why this is no longer automatic.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getAppSettings();
    const notes = await req
      .json()
      .then((b) => (typeof b?.notes === "string" ? b.notes : undefined))
      .catch(() => undefined);

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        propertyId: true,
        jobType: true,
        scheduledDate: true,
        startTime: true,
        dueTime: true,
        estimatedHours: true,
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.status === JobStatus.INVOICED) {
      return NextResponse.json(
        { error: "This job is invoiced and can't spawn a rework job." },
        { status: 409 },
      );
    }

    // Re-check rather than trusting the client's view of the world: the page
    // may have been open a while, and an inspector could have raised a rework
    // in the meantime.
    const context = await getAdminReworkContext(job);
    if (context.existingReworkJobId) {
      return NextResponse.json({
        ok: true,
        created: false,
        reworkJobId: context.existingReworkJobId,
        message: "A rework job already exists for this job.",
      });
    }

    const reworkJobId = await createAdminReworkJob({
      job,
      settings,
      actorId: session.user.id,
    });
    if (!reworkJobId) {
      return NextResponse.json({
        ok: true,
        created: false,
        message: "A rework job already exists for this job.",
      });
    }

    await assignPreferredCleanerIfAvailable({
      jobId: reworkJobId,
      propertyId: job.propertyId,
      jobType: job.jobType,
    }).catch(() => null);

    // Tell the client we found something we're putting right (ISSUE_RAISED on
    // the ORIGINAL job), then confirm the re-clean and its schedule
    // (RECLEAN_SCHEDULED on the rework job, whose date the lifecycle service
    // reads). Best-effort: a mail failure must not undo the job.
    await sendLifecycleEmail({
      jobId: job.id,
      stage: "ISSUE_RAISED",
      mode: "auto",
      extra: { reason: notes?.trim() || undefined },
    }).catch((err) => logger.error({ err, jobId: job.id }, "rework ISSUE_RAISED email failed"));
    await sendLifecycleEmail({
      jobId: reworkJobId,
      stage: "RECLEAN_SCHEDULED",
      mode: "auto",
    }).catch((err) => logger.error({ err, jobId: reworkJobId }, "RECLEAN_SCHEDULED email failed"));

    return NextResponse.json({ ok: true, created: true, reworkJobId });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
