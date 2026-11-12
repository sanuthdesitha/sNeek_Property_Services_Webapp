"use client";

/**
 * Quick assign for an unassigned job (moved unchanged from the workspace):
 * pick cleaners, the first becomes primary, and the job's existing assign
 * route applies its own rules.
 */
import { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { JobDialog } from "./job-dialog";
import { ECheck, jobTypeLabel, scheduledLabel } from "./job-row";
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

export function QuickAssignDialog({ job, cleaners, onClose, onAssigned }: QuickAssignProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [leaveConflict, setLeaveConflict] = useState<string | null>(null);
  useEffect(() => {
    setSelected([]);
    setLeaveConflict(null);
  }, [job?.id]);

  async function submit(confirmLeaveConflict = false) {
    if (!job || selected.length === 0) {
      toast({ title: "Select at least one cleaner.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await assignCleaners(job.id, selected, confirmLeaveConflict);
      toast({ title: "Assigned", description: `${selected.length} cleaner(s) assigned.` });
      onAssigned();
    } catch (error) {
      if (error instanceof LeaveConflictError) {
        setLeaveConflict(error.message);
        return;
      }
      toast({ title: "Assign failed", description: error instanceof Error ? error.message : "Could not assign job.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <JobDialog open={Boolean(job)} title="Assign cleaners" busy={submitting} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.5)] p-3">
          <p className="e-serif text-[0.9375rem] font-[520]">{job?.property?.name ?? "Unassigned job"}</p>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {jobTypeLabel(job?.jobType)} · {scheduledLabel(job?.scheduledDate, "dd MMM yyyy")}
            {job?.startTime ? ` · ${job.startTime}` : ""}
          </p>
        </div>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {cleaners.length === 0 ? (
            <p className="py-4 text-center text-[0.8125rem] text-[hsl(var(--e-text-faint))]">No active cleaner accounts.</p>
          ) : cleaners.map((cleaner) => {
            const checked = selected.includes(cleaner.id);
            return (
              <button
                key={cleaner.id}
                type="button"
                onClick={() => {
                  setLeaveConflict(null);
                  setSelected((current) => (checked ? current.filter((id) => id !== cleaner.id) : [...current, cleaner.id]));
                }}
                className={"flex w-full items-center gap-3 rounded-[var(--e-radius)] border px-3 py-2 text-left " +
                  (checked ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]" : "border-transparent hover:bg-[hsl(var(--e-muted))]")}
              >
                <ECheck checked={checked} onChange={() => {}} label={cleaner.name} />
                <span className="min-w-0">
                  <span className="block truncate text-[0.875rem] font-[550]">{cleaner.name || cleaner.email}</span>
                  <span className="block truncate text-[0.75rem] text-[hsl(var(--e-text-faint))]">{cleaner.email}</span>
                </span>
              </button>
            );
          })}
        </div>
        {leaveConflict ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.4)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-warning))]">
            <span className="min-w-0 [overflow-wrap:anywhere]">{leaveConflict}</span>
            <EButton size="sm" variant="outline" disabled={submitting} onClick={() => void submit(true)}>Assign anyway</EButton>
          </div>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
          <EButton variant="outline" onClick={onClose} disabled={submitting}>Cancel</EButton>
          <EButton onClick={() => void submit()} disabled={submitting || selected.length === 0}>
            {submitting ? "Assigning…" : `Assign${selected.length > 0 ? ` (${selected.length})` : ""}`}
          </EButton>
        </div>
      </div>
    </JobDialog>
  );
}
