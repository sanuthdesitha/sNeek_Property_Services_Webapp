import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  getOrCreateDamageDraft,
  saveDamageDraft,
  submitDamageReport,
} from "@/lib/damage/service";
import {
  saveDamageDraftSchema,
  submitDamageReportSchema,
} from "@/lib/damage/validation";
import { getValidationErrorMessage } from "@/lib/validations/errors";

/**
 * The cleaner's damage report for one job.
 *
 *   GET  — the open draft, created on first open, with items and photos.
 *   PUT  — autosave. Called on every edit, so it must be cheap and forgiving.
 *   POST — submit: one DAMAGE case per item, CP-7 raises the repairs.
 *
 * Access is the same rule the rest of the cleaner portal uses: signed in as a
 * CLEANER **and** currently assigned to this job. Checking the role alone would
 * let any cleaner file damage against any property in the business.
 *
 * PUT and POST both take the full item list rather than a patch. The form owns
 * the list, and a dropped partial request must never leave a saved draft in a
 * state the cleaner never saw.
 */

/** The job, only if this cleaner is actually on it. */
async function requireAssignedJob(jobId: string, userId: string) {
  const job = await db.job.findFirst({
    where: {
      id: jobId,
      assignments: { some: { userId, removedAt: null } },
    },
    select: { id: true, propertyId: true },
  });
  if (!job) throw new Error("NOT_FOUND");
  return job;
}

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "";
  switch (message) {
    case "UNAUTHORIZED":
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    case "FORBIDDEN":
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    case "NOT_FOUND":
    case "DAMAGE_REPORT_NOT_FOUND":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "DAMAGE_REPORT_NOT_EDITABLE":
      return NextResponse.json(
        { error: "This report has already been submitted and can no longer be edited." },
        { status: 409 }
      );
    case "DAMAGE_REPORT_EMPTY":
      return NextResponse.json(
        { error: "Add at least one damaged item before submitting." },
        { status: 400 }
      );
    default:
      return NextResponse.json(
        { error: getValidationErrorMessage(err, "Could not save the damage report.") },
        { status: 400 }
      );
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const job = await requireAssignedJob(params.id, session.user.id);
    const report = await getOrCreateDamageDraft({
      jobId: job.id,
      propertyId: job.propertyId,
      userId: session.user.id,
    });
    return NextResponse.json({ report });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const job = await requireAssignedJob(params.id, session.user.id);

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid" }, { status: 400 });
    }
    const body = saveDamageDraftSchema.parse(payload);

    // Resolve the draft here rather than trusting a client-supplied report id:
    // it keeps autosave idempotent on a fresh form and stops one cleaner
    // autosaving over another's report.
    const draft = await getOrCreateDamageDraft({
      jobId: job.id,
      propertyId: job.propertyId,
      userId: session.user.id,
    });

    const report = await saveDamageDraft({
      reportId: draft.id,
      userId: session.user.id,
      items: body.items,
    });
    return NextResponse.json({ report });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const job = await requireAssignedJob(params.id, session.user.id);

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid" }, { status: 400 });
    }
    const body = submitDamageReportSchema.parse(payload);

    const draft = await getOrCreateDamageDraft({
      jobId: job.id,
      propertyId: job.propertyId,
      userId: session.user.id,
    });

    const report = await submitDamageReport({
      reportId: draft.id,
      userId: session.user.id,
      items: body.items,
    });
    return NextResponse.json({ report });
  } catch (err) {
    return errorResponse(err);
  }
}
