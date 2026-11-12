"use client";

/**
 * Shared "assign cleaners" ceremony — used by the jobs board, the Estate
 * schedule/calendar and the job-detail assign panel. Wraps the same endpoint
 * the v1 dispatch console uses:  POST /api/admin/jobs/:id/assign
 *   body { userIds: string[], primaryUserId?: string }
 * Passing an empty userIds list clears every assignee (matches the API).
 * A newly added cleaner with recorded leave that day is refused (409
 * LEAVE_CONFLICT) with the reason; "Assign anyway" resends with the explicit
 * override `confirmLeaveConflict`.
 */

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EModal } from "@/components/v2/admin/estate-kit";
import { ECheck } from "@/components/v2/admin/jobs/job-row";
import { ReassignNoteDialog, parseReassignPreview, type ReassignPreview } from "@/components/v2/admin/jobs/reassign-note-dialog";

export type AssignCleaner = { id: string; name: string; email: string };

export function AssignCleanersModal({
  open,
  onClose,
  jobId,
  jobLabel,
  jobSubLabel,
  cleaners,
  initialAssignedIds,
  initialPrimaryId,
  onAssigned,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string | null;
  jobLabel?: string;
  jobSubLabel?: string;
  cleaners: AssignCleaner[];
  initialAssignedIds?: string[];
  initialPrimaryId?: string | null;
  /** Called after a successful assign so the caller can refetch. */
  onAssigned: () => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [primary, setPrimary] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The pending "your cleaner has changed" draft, when this assignment
  // replaced an existing primary. Null means there is nothing to confirm.
  const [reassign, setReassign] = useState<ReassignPreview | null>(null);
  // The leave refusal for the current selection; cleared when it changes.
  const [leaveConflict, setLeaveConflict] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const init = initialAssignedIds ?? [];
    setSelected(init);
    setPrimary(initialPrimaryId ?? init[0] ?? null);
    setLeaveConflict(null);
  }, [open, initialAssignedIds, initialPrimaryId, jobId]);

  function toggle(id: string) {
    setLeaveConflict(null);
    setSelected((current) => {
      const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
      // Keep a valid primary: default to the first still-selected cleaner.
      setPrimary((currentPrimary) =>
        next.includes(currentPrimary ?? "") ? currentPrimary : next[0] ?? null
      );
      return next;
    });
  }

  async function submit(confirmLeaveConflict = false) {
    if (!jobId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: selected,
          primaryUserId: selected.length > 0 ? primary ?? selected[0] : undefined,
          ...(confirmLeaveConflict ? { confirmLeaveConflict: true } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body?.code === "LEAVE_CONFLICT") {
        setLeaveConflict(typeof body.error === "string" ? body.error : "A selected cleaner is on leave that day.");
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "Could not assign job.");
      toast({
        title: selected.length === 0 ? "Assignees cleared" : "Assignment saved",
        description:
          selected.length === 0
            ? "This job is now unassigned."
            : `${selected.length} cleaner${selected.length === 1 ? "" : "s"} assigned.`,
      });
      onClose();
      await onAssigned();

      // The dispatch is done either way. If the primary cleaner REPLACED
      // someone, the server declined to email the client on its own and handed
      // back a draft instead — telling a client their cleaner has changed is a
      // message a person should read before it goes out.
      const preview = parseReassignPreview(body, jobId);
      if (preview) setReassign(preview);
    } catch (err: any) {
      toast({ title: "Assign failed", description: err?.message ?? "Could not assign job.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const original = (initialAssignedIds ?? []).slice().sort().join(",");
  const current = selected.slice().sort().join(",");
  const dirty = original !== current || (selected.length > 0 && (primary ?? selected[0]) !== (initialPrimaryId ?? (initialAssignedIds ?? [])[0] ?? null));

  if (reassign) {
    // Shown AFTER the assignment has saved (see ReassignNoteDialog).
    return <ReassignNoteDialog preview={reassign} onClose={() => setReassign(null)} />;
  }

  return (
    <EModal open={open} onClose={onClose} title="Assign cleaners" eyebrow="Dispatch" size="wide">
      <div className="space-y-4">
        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.5)] p-3">
          <p className="e-serif text-[0.9375rem] font-[520]">{jobLabel ?? "Job"}</p>
          {jobSubLabel ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{jobSubLabel}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between px-0.5">
          <p className="text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))]">
            {selected.length === 0 ? "No cleaners selected" : `${selected.length} selected`}
          </p>
          <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">Star marks the primary cleaner</p>
        </div>

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {cleaners.length === 0 ? (
            <p className="py-4 text-center text-[0.8125rem] text-[hsl(var(--e-text-faint))]">
              No active cleaner accounts.
            </p>
          ) : (
            cleaners.map((cleaner) => {
              const checked = selected.includes(cleaner.id);
              const isPrimary = checked && (primary ?? selected[0]) === cleaner.id;
              return (
                <div
                  key={cleaner.id}
                  className={
                    "flex items-center gap-3 rounded-[var(--e-radius)] border px-3 py-2 transition-colors duration-[160ms] " +
                    (checked
                      ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]"
                      : "border-transparent hover:bg-[hsl(var(--e-muted))]")
                  }
                >
                  <button
                    type="button"
                    onClick={() => toggle(cleaner.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <ECheck checked={checked} onChange={() => toggle(cleaner.id)} label={cleaner.name} />
                    <span className="min-w-0">
                      <span className="block truncate text-[0.875rem] font-[550]">{cleaner.name || cleaner.email}</span>
                      <span className="block truncate text-[0.75rem] text-[hsl(var(--e-text-faint))]">{cleaner.email}</span>
                    </span>
                  </button>
                  {checked ? (
                    <button
                      type="button"
                      onClick={() => setPrimary(cleaner.id)}
                      aria-label={isPrimary ? "Primary cleaner" : "Make primary"}
                      aria-pressed={isPrimary}
                      className={
                        "inline-flex items-center gap-1 rounded-[var(--e-radius-pill)] border px-2 py-1 text-[0.6875rem] font-[550] transition-colors " +
                        (isPrimary
                          ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))]"
                          : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
                      }
                    >
                      <Star className="h-3 w-3" fill={isPrimary ? "currentColor" : "none"} />
                      {isPrimary ? "Primary" : "Set primary"}
                    </button>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {leaveConflict ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.4)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-warning))]">
            <span className="min-w-0 [overflow-wrap:anywhere]">{leaveConflict}</span>
            <EButton size="sm" variant="outline" disabled={submitting} onClick={() => void submit(true)}>Assign anyway</EButton>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] pt-4">
          <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
            Assigned cleaners are notified by email &amp; SMS.
          </p>
          <div className="flex gap-2">
            <EButton variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </EButton>
            <EButton variant="gold" onClick={() => void submit()} disabled={submitting || !dirty}>
              {submitting
                ? "Saving…"
                : selected.length === 0
                  ? "Clear assignees"
                  : `Save assignment${selected.length > 0 ? ` (${selected.length})` : ""}`}
            </EButton>
          </div>
        </div>
      </div>
    </EModal>
  );
}
