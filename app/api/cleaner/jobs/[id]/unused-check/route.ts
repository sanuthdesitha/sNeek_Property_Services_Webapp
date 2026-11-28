/**
 * "Looks unused — ask the office" for the assigned cleaner (2026-11-28).
 *
 * GET   the questions on this job and whether this cleaner may ask now.
 * POST  ask the office before cleaning: { requestKey, note?, photoKeys? }.
 *       One open question per job; the same requestKey returns the same row.
 *
 * Live session and role on every call; the cleaner must hold an assignment.
 * Refused while an administrator is testing as the cleaner. The question and
 * its answer never change the job, its schedule or pay.
 */
import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { unusedCheckEnabled } from "@/lib/pilots/gates";
import { deliverInboxIntentsNow } from "@/lib/notifications/inline-dispatch";
import { askUnusedCheck, listUnusedChecksForCleaner, UnusedCheckError } from "@/lib/jobs/unused-check";
import { unusedCheckEligibility, type UnusedCheckCleanerPayload } from "@/lib/jobs/unused-check-rules";

const privateHeaders = { "Cache-Control": "private, no-store" };

function refuse(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status, headers: privateHeaders });
}

function failure(err: unknown) {
  if (err instanceof UnusedCheckError) return refuse(err.status, err.message, err.code);
  if (err instanceof ZodError) return refuse(400, "Check the note and photos, then try again.", "INVALID_INPUT");
  const message = err instanceof Error ? err.message : "";
  if (message === "UNAUTHORIZED") return refuse(401, "Sign in again.", "UNAUTHORIZED");
  if (message === "FORBIDDEN") return refuse(403, "You cannot do this.", "FORBIDDEN");
  return refuse(500, "Could not reach the office. Your note is kept; try again.", "FAILED");
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    const assignment = await db.jobAssignment.findFirst({
      where: { jobId: params.id, userId: session.user.id, removedAt: null },
      select: { responseStatus: true },
    });
    if (!assignment) return refuse(403, "You are not assigned to this job.", "NOT_ASSIGNED");
    const job = await db.job.findUnique({ where: { id: params.id }, select: { status: true, jobType: true, propertyId: true } });
    if (!job) return refuse(404, "Job not found.", "NOT_FOUND");
    // Pilot "Looks unused — ask the office": off → not offered (questions already asked stay readable).
    const enabled = await unusedCheckEnabled({ userId: session.user.id, propertyId: job.propertyId });
    const checks = await listUnusedChecksForCleaner(params.id, session.user.id);
    const eligibility = unusedCheckEligibility({ jobType: job.jobType, jobStatus: job.status, responseStatus: assignment.responseStatus });
    const waiting = checks.some((check) => check.status === "WAITING");
    const refusal = !enabled
      ? "Not switched on for this job."
      : session.impersonation
      ? "Only the cleaner can ask the office."
      : !eligibility.ok
        ? eligibility.reason
        : waiting
          ? "The office has not answered yet."
          : null;
    const timeZone = (await getAppSettings().catch(() => null))?.timezone ?? "Australia/Sydney";
    const payload: UnusedCheckCleanerPayload = { jobId: params.id, checks, canAsk: refusal === null, refusal, timeZone, enabled };
    return NextResponse.json(payload, { headers: privateHeaders });
  } catch (err) {
    return failure(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    if (session.impersonation) return refuse(403, "Only the cleaner can ask the office.", "IMPERSONATION_NOT_ALLOWED");
    const pilotJob = await db.job.findUnique({ where: { id: params.id }, select: { propertyId: true } });
    if (!pilotJob) return refuse(404, "Job not found.", "NOT_FOUND");
    if (!(await unusedCheckEnabled({ userId: session.user.id, propertyId: pilotJob.propertyId }))) {
      return refuse(409, "Asking the office from the app is not switched on for this job. Call the office.", "PILOT_OFF");
    }
    const body = await req.json().catch(() => null);
    const result = await askUnusedCheck({ id: session.user.id, role: Role.CLEANER }, params.id, body);
    // Office inboxes now, rather than at the next pipeline run. Queued is not delivered.
    const states = result.intentIds.length > 0 ? await deliverInboxIntentsNow(result.intentIds) : new Map();
    const inInbox = Array.from(states.values()).filter((state) => state.state === "inbox_available").length;
    const checks = await listUnusedChecksForCleaner(params.id, session.user.id);
    return NextResponse.json(
      {
        outcome: result.outcome,
        checkId: result.check.id,
        checks,
        office: { queued: result.intentIds.length, inInbox },
      },
      { status: result.outcome === "CREATED" ? 201 : 200, headers: privateHeaders },
    );
  } catch (err) {
    return failure(err);
  }
}
