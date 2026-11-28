import "server-only";
/**
 * "I can't attend" and "Running late" (pilot "Before-you-start extras",
 * 2026-11-28), server side. The assigned cleaner tells the office before
 * starting; the notice is an audit row on the job (its History) and inbox
 * notices to the office through the intent pipeline (inbox + the approvals
 * phone push). Never email, SMS or the client. A retry with the same request
 * key is the same notice. Nothing on the job, assignment or pay changes.
 */
import { Prisma, Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { enqueueNotificationIntent } from "@/lib/notifications/intent-store";
import { authorizeEntityRecipient } from "@/lib/notifications/recipient-scopes";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { ATTENDANCE_NOTICE_STATUSES, attendanceNoticeInput, type AttendanceNoticeKind } from "./attendance-notice-rules";

export const ATTENDANCE_NOTICE_TYPE_KEY = "job.attendance_notice";
const EVENT_KEYS: Record<AttendanceNoticeKind, string> = {
  CANT_ATTEND: "job_attendance.cant_attend",
  RUNNING_LATE: "job_attendance.running_late",
};
const AUDIT_ACTIONS: Record<AttendanceNoticeKind, string> = {
  CANT_ATTEND: "JOB_CLEANER_CANT_ATTEND",
  RUNNING_LATE: "JOB_CLEANER_RUNNING_LATE",
};

export class AttendanceNoticeError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

export type AttendanceNoticeResult = { outcome: "SENT" | "REPLAYED"; intentIds: string[] };

export async function sendAttendanceNotice(
  actor: { id: string },
  jobId: string,
  raw: unknown,
  timeZone: string,
): Promise<AttendanceNoticeResult> {
  const input = attendanceNoticeInput.parse(raw);
  const wording = await loadNotificationWording(ATTENDANCE_NOTICE_TYPE_KEY);
  const noticeId = `${jobId}:${actor.id}:${input.requestKey}`;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`job-attendance:${noticeId}`}))`;
    const replay = await tx.auditLog.findFirst({ where: { entity: "JobAttendanceNotice", entityId: noticeId }, select: { id: true } });
    if (replay) return { outcome: "REPLAYED" as const, intentIds: [] };
    const assignment = await tx.jobAssignment.findFirst({ where: { jobId, userId: actor.id, removedAt: null }, select: { id: true } });
    if (!assignment) throw new AttendanceNoticeError(403, "You are not assigned to this job.", "NOT_ASSIGNED");
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: { status: true, jobNumber: true, scheduledDate: true, startTime: true, property: { select: { name: true } } },
    });
    if (!job) throw new AttendanceNoticeError(404, "Job not found.", "NOT_FOUND");
    if (!ATTENDANCE_NOTICE_STATUSES.includes(job.status)) throw new AttendanceNoticeError(409, "This job has already started or finished. Use the job's other actions.", "NOT_ELIGIBLE");
    const started = await tx.timeLog.findFirst({ where: { jobId, userId: actor.id }, select: { id: true } });
    if (started) throw new AttendanceNoticeError(409, "You have already clocked in on this job.", "ALREADY_STARTED");

    await tx.auditLog.create({
      data: {
        userId: actor.id,
        jobId,
        action: AUDIT_ACTIONS[input.kind],
        entity: "JobAttendanceNotice",
        entityId: noticeId,
        after: { kind: input.kind, reason: input.reason, minutes: input.kind === "RUNNING_LATE" ? input.minutes : null } as Prisma.InputJsonValue,
      },
    });

    const cleaner = await tx.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } });
    const when = `${formatInTimeZone(job.scheduledDate, timeZone, "EEE d MMM")}${job.startTime ? ` ${job.startTime}` : ""}`;
    const variables = {
      cleanerName: cleaner?.name || cleaner?.email || "A cleaner",
      propertyName: job.property?.name ?? "the property",
      jobNumber: job.jobNumber,
      when,
      reason: input.reason,
      minutes: input.kind === "RUNNING_LATE" ? String(input.minutes) : "",
    };
    const text = wording.render(input.kind === "CANT_ATTEND" ? "cant-attend" : "running-late", "INBOX", variables);
    const candidates = await tx.user.findMany({ where: { isActive: true, role: { in: [Role.ADMIN, Role.OPS_MANAGER] } }, select: { id: true, role: true }, orderBy: { id: "asc" } });
    const intentIds: string[] = [];
    for (const candidate of candidates) {
      const scope = { kind: "ENTITY" as const, type: "JOB_OFFICE" as const, id: jobId };
      const authorization = await authorizeEntityRecipient(tx, { userId: candidate.id, role: candidate.role, scope });
      if (!authorization.ok) continue;
      const intent = await enqueueNotificationIntent(tx, {
        version: 1,
        eventId: `attendance:${noticeId}`,
        eventKey: EVENT_KEYS[input.kind],
        entity: { type: "job", id: jobId },
        actorId: actor.id,
        recipient: { userId: candidate.id, role: candidate.role, scope },
        severity: "ACTION",
        category: "approvals",
        transport: "INBOX",
        mobilePushCategory: "approvals",
        url: `/v2/admin/jobs/${encodeURIComponent(jobId)}`,
        subject: text.title,
        body: text.body,
        jobId,
      });
      intentIds.push(intent.id);
    }
    return { outcome: "SENT" as const, intentIds };
  });
}
