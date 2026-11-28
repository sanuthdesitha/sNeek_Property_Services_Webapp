/**
 * "Camera not working — ask the office" for the assigned cleaner (cleaner job flow v2, item 2).
 *
 * GET   the requests on this job, the questions the office allowed, and
 *       whether this cleaner may ask now.
 * POST  ask to submit without specific missing photos:
 *       { requestKey, note, fields: [{ fieldId, label }] }. One open request
 *       per job; the same requestKey returns the same row.
 *
 * Live session and role on every call; the cleaner must hold an assignment.
 * Refused while an administrator is testing as the cleaner. Asking is offered
 * only where the pilot "New cleaner job flow" is on for this cleaner, property
 * and job; reading (and the office's decisions already given) always works.
 */
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { cleanerJobFlowOn } from "@/lib/pilots/gates";
import { deliverInboxIntentsNow } from "@/lib/notifications/inline-dispatch";
import { askEvidenceOverride, EvidenceOverrideError, listEvidenceOverridesForCleaner } from "@/lib/jobs/evidence-override";
import { allowedFieldsOf, type EvidenceOverrideCleanerPayload } from "@/lib/jobs/evidence-override-rules";

const privateHeaders = { "Cache-Control": "private, no-store" };

function refuse(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status, headers: privateHeaders });
}

function failure(err: unknown) {
  if (err instanceof EvidenceOverrideError) return refuse(err.status, err.message, err.code);
  if (err instanceof ZodError) return refuse(400, "Choose the photos and say why they cannot be taken (at least 5 characters).", "INVALID_INPUT");
  const message = err instanceof Error ? err.message : "";
  if (message === "UNAUTHORIZED") return refuse(401, "Sign in again.", "UNAUTHORIZED");
  if (message === "FORBIDDEN") return refuse(403, "You cannot do this.", "FORBIDDEN");
  return refuse(500, "Could not reach the office. Your note is kept; try again.", "FAILED");
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const assignment = await db.jobAssignment.findFirst({ where: { jobId: params.id, userId: session.user.id, removedAt: null }, select: { id: true } });
    if (!assignment) return refuse(403, "You are not assigned to this job.", "NOT_ASSIGNED");
    const job = await db.job.findUnique({ where: { id: params.id }, select: { propertyId: true } });
    if (!job) return refuse(404, "Job not found.", "NOT_FOUND");
    const enabled = await cleanerJobFlowOn(db, { jobId: params.id, userId: session.user.id, propertyId: job.propertyId });
    const requests = await listEvidenceOverridesForCleaner(params.id);
    const waiting = requests.some((request) => request.status === "REQUESTED");
    const refusal = !enabled
      ? "Not switched on for this job. Call the office."
      : session.impersonation
        ? "Only the cleaner can ask the office."
        : waiting
          ? "The office has not answered yet."
          : null;
    const timeZone = (await getAppSettings().catch(() => null))?.timezone ?? "Australia/Sydney";
    const payload: EvidenceOverrideCleanerPayload = {
      jobId: params.id,
      requests,
      allowedFieldIds: allowedFieldsOf(requests),
      canAsk: refusal === null,
      refusal,
      timeZone,
    };
    return NextResponse.json(payload, { headers: privateHeaders });
  } catch (err) {
    return failure(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    if (session.impersonation) return refuse(403, "Only the cleaner can ask the office.", "IMPERSONATION_NOT_ALLOWED");
    const job = await db.job.findUnique({ where: { id: params.id }, select: { propertyId: true } });
    if (!job) return refuse(404, "Job not found.", "NOT_FOUND");
    if (!(await cleanerJobFlowOn(db, { jobId: params.id, userId: session.user.id, propertyId: job.propertyId }))) {
      return refuse(409, "Asking the office from the app is not switched on for this job. Call the office.", "PILOT_OFF");
    }
    const body = await req.json().catch(() => null);
    const result = await askEvidenceOverride({ id: session.user.id, role: Role.CLEANER }, params.id, body);
    // Office inboxes now, rather than at the next pipeline run. Queued is not delivered.
    const states = result.intentIds.length > 0 ? await deliverInboxIntentsNow(result.intentIds) : new Map();
    const inInbox = Array.from(states.values()).filter((state) => state.state === "inbox_available").length;
    return NextResponse.json(
      { outcome: result.outcome, id: result.request.id, status: result.request.status, office: { queued: result.intentIds.length, inInbox } },
      { status: result.outcome === "CREATED" ? 201 : 200, headers: privateHeaders },
    );
  } catch (err) {
    return failure(err);
  }
}
