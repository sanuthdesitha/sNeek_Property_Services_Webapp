"use client";

/**
 * Quick assign for an unassigned job from the Jobs list. Since 2026-11 it is
 * the shared `AssignDialog` (the same window as the job page and Calendar);
 * the request body is unchanged: { userIds, primaryUserId, confirmLeaveConflict? }.
 * `assignCleaners` stays for the peek panel's one-click suggestion.
 */
import { AssignDialog, type AssignTarget } from "./assign-dialog";
import { jobTypeLabel, scheduledLabel } from "./job-row";
import type { JobsPersonOption } from "./jobs-constants";
import type { JobListRow } from "./jobs-query";

type QuickAssignProps = {
  job: JobListRow | null;
  cleaners: JobsPersonOption[];
  onClose: () => void;
  onAssigned: () => void;
};

/** The assign route refused because a cleaner has recorded leave that day. */
export class LeaveConflictError extends Error {}

export async function assignCleaners(jobId: string, userIds: string[], confirmLeaveConflict = false): Promise<void> {
  const res = await fetch(`/api/admin/jobs/${jobId}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds, primaryUserId: userIds[0], ...(confirmLeaveConflict ? { confirmLeaveConflict: true } : {}) }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (res.status === 409 && body.code === "LEAVE_CONFLICT") throw new LeaveConflictError(body.error ?? "A selected cleaner is on leave that day.");
  if (!res.ok) throw new Error(body.error ?? "Could not assign job.");
}

/** Quick assign from the Jobs list: the shared assign dialog for an unassigned job. */
export function QuickAssignDialog({ job, cleaners, onClose, onAssigned }: QuickAssignProps) {
  const target: AssignTarget | null = job
    ? {
        kind: "job",
        jobId: job.id,
        context: [job.jobNumber ? String(job.jobNumber) : null, job.property?.name ?? "Unassigned job", `${scheduledLabel(job.scheduledDate, "EEE d MMM")}${job.startTime ? ` ${job.startTime}` : ""}`].filter(Boolean).join(" · "),
        phoneTitle: `Assign · ${job.property?.name ?? jobTypeLabel(job.jobType)}, ${scheduledLabel(job.scheduledDate, "EEE d MMM")}`,
        initialAssignedIds: [],
        initialPrimaryId: null,
      }
    : null;
  return <AssignDialog open={Boolean(job)} target={target} cleaners={cleaners} onClose={onClose} onAssigned={() => onAssigned()} />;
}
