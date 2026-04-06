import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { cleanerLaundryStatusSchema } from "@/lib/validations/job";
import { applyCleanerLaundryStatusUpdate } from "@/lib/laundry/cleaner-status";
import { resolveAppUrl } from "@/lib/app-url";

function normalizeLaundrySubmission(body: {
  laundryReady?: boolean;
  laundryOutcome?: "READY_FOR_PICKUP" | "NOT_READY" | "NO_PICKUP_REQUIRED";
}) {
  return (
    body.laundryOutcome ??
    (body.laundryReady === true
      ? "READY_FOR_PICKUP"
      : body.laundryReady === false
        ? "NOT_READY"
        : undefined)
  );
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const body = cleanerLaundryStatusSchema.parse(await req.json());
    const laundryOutcome = normalizeLaundrySubmission(body);
    if (!laundryOutcome) {
      return NextResponse.json({ error: "Laundry outcome is required." }, { status: 400 });
    }

    const assignment = await db.jobAssignment.findFirst({
      where: {
        jobId: params.id,
        userId: session.user.id,
        removedAt: null,
      },
      select: { id: true },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Not assigned to this job" }, { status: 403 });
    }

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const lockedStatuses: JobStatus[] = [
      JobStatus.SUBMITTED,
      JobStatus.QA_REVIEW,
      JobStatus.COMPLETED,
      JobStatus.INVOICED,
    ];
    if (lockedStatuses.includes(job.status)) {
      return NextResponse.json({ error: "Job is already finished." }, { status: 400 });
    }

    const hasStartedLog = await db.timeLog.findFirst({
      where: { jobId: params.id, userId: session.user.id },
      select: { id: true },
    });
    if (!hasStartedLog) {
      return NextResponse.json(
        { error: "Start the job before sending laundry updates." },
        { status: 409 }
      );
    }

    const bagLocation = body.bagLocation?.trim();
    const laundrySkipReasonCode = body.laundrySkipReasonCode?.trim();
    const laundrySkipReasonNote = body.laundrySkipReasonNote?.trim();
    const laundryPhotoKey = body.laundryPhotoKey?.trim();

    if (laundryOutcome === "READY_FOR_PICKUP") {
      if (!bagLocation) {
        return NextResponse.json(
          { error: "Bag location is required when laundry is marked ready." },
          { status: 400 }
        );
      }
      if (!laundryPhotoKey) {
        return NextResponse.json(
          { error: "Laundry photo is required when laundry is marked ready." },
          { status: 400 }
        );
      }
    }

    if (
      (laundryOutcome === "NOT_READY" || laundryOutcome === "NO_PICKUP_REQUIRED") &&
      !laundrySkipReasonCode
    ) {
      return NextResponse.json(
        { error: "Select a reason when laundry is not ready or no pickup is required." },
        { status: 400 }
      );
    }

    const result = await applyCleanerLaundryStatusUpdate({
      jobId: params.id,
      cleanerId: session.user.id,
      laundryOutcome,
      bagLocation,
      laundryPhotoKey,
      laundrySkipReasonCode,
      laundrySkipReasonNote,
      source: "EARLY_UPDATE",
      portalUrl: resolveAppUrl("/laundry", req),
    });

    return NextResponse.json({
      ok: true,
      duplicated: result.duplicated,
      status: result.laundryTask.status,
      updatedAt: result.laundryTask.updatedAt,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
