/**
 * POST /api/cleaner/jobs/[id]/reminders/ack — the cleaner confirms one smart
 * property reminder on this job ({ reminderKey }): a room reminder ("Done")
 * or a before-leaving reminder. Pilot "Property reminders", 2026-11-28.
 *
 * Live guard: CLEANER, assigned to the job (not removed), job not finished.
 * Refused while an administrator is acting as the cleaner (a confirmation is
 * the cleaner's own statement). The reminder must apply to this job and
 * person now, decided on the server; pilot off → refused, nothing recorded.
 * Repeating the same confirmation returns the first one (idempotent).
 */
import { NextRequest, NextResponse } from "next/server";
import { JobStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { reminderSource } from "@/lib/pilots/gates";

const schema = z.object({ reminderKey: z.string().trim().min(1).max(200) });

const FINISHED_STATUSES: JobStatus[] = [JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED];
const privateHeaders = { "Cache-Control": "private, no-store" };

function refuse(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status, headers: privateHeaders });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.CLEANER]);
    if (session.impersonation) return refuse(403, "Only the cleaner can confirm a reminder.", "IMPERSONATION_NOT_ALLOWED");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return refuse(400, "Choose the reminder to confirm.", "INVALID_INPUT");

    const assignment = await db.jobAssignment.findFirst({ where: { jobId: params.id, userId: session.user.id, removedAt: null }, select: { id: true } });
    if (!assignment) return refuse(403, "Not assigned to this job", "FORBIDDEN");
    const job = await db.job.findUnique({ where: { id: params.id }, select: { id: true, status: true, propertyId: true, property: { select: { features: true } } } });
    if (!job) return refuse(404, "Job not found", "NOT_FOUND");
    if (FINISHED_STATUSES.includes(job.status)) return refuse(409, "This job is already finished.", "JOB_FINISHED");

    const source = await reminderSource(job.property, { userId: session.user.id, propertyId: job.propertyId }, job.id);
    if (source?.remindersUnavailable) return refuse(503, "Reminders could not be read. Try again.", "REMINDERS_UNAVAILABLE");
    const reminder = source?.reminders?.find((item) => item.key === parsed.data.reminderKey);
    if (!reminder) return refuse(409, "This reminder no longer applies to this job.", "REMINDER_NOT_CURRENT");

    const ack = await db.propertyReminderAck.upsert({
      where: { reminderKey_jobId_userId: { reminderKey: reminder.key, jobId: job.id, userId: session.user.id } },
      create: { reminderKey: reminder.key, jobId: job.id, userId: session.user.id, moment: reminder.moment, text: reminder.text },
      update: {},
      select: { reminderKey: true, acknowledgedAt: true },
    });
    return NextResponse.json({ ok: true, reminderKey: ack.reminderKey, acknowledgedAt: ack.acknowledgedAt.toISOString() }, { headers: privateHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return refuse(401, "Sign in again.", "UNAUTHORIZED");
    if (message === "FORBIDDEN") return refuse(403, "You cannot confirm this.", "FORBIDDEN");
    console.error("[property-reminders] confirmation failed", error);
    return refuse(500, "Could not save. Try again.", "FAILED");
  }
}
