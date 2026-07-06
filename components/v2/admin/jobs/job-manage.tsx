"use client";

/**
 * ESTATE job manage modal — per-job mutations from the jobs board, v2-native.
 * Mirrors the v1 job-detail action hub for the operations that matter daily:
 *   · Reschedule (POST /api/admin/phase4/reschedule/:id/apply)
 *   · Pricing & notes (PATCH /api/admin/jobs/:id — partial update)
 *   · Skip controls (PATCH /api/admin/jobs/:id/skip — set/approve/decline/unskip)
 *   · Danger zone (POST reset / DELETE — both security-verified)
 * Same endpoints and payloads as v1; entirely Estate presentation.
 */
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { CalendarClock, CircleDollarSign, CircleSlash, ShieldAlert } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import {
  EConfirmModal,
  EField,
  EInput,
  EModal,
  ETextarea,
} from "@/components/v2/admin/estate-kit";
import { statusLabel, statusTone } from "./job-row";

const TZ = "Australia/Sydney";

type Section = "schedule" | "pricing" | "skip" | "danger";

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "schedule", label: "Schedule", icon: <CalendarClock className="h-3.5 w-3.5" /> },
  { id: "pricing", label: "Pricing & notes", icon: <CircleDollarSign className="h-3.5 w-3.5" /> },
  { id: "skip", label: "Skip", icon: <CircleSlash className="h-3.5 w-3.5" /> },
  { id: "danger", label: "Danger", icon: <ShieldAlert className="h-3.5 w-3.5" /> },
];

function sydneyDateInput(value: unknown): string {
  if (!value) return "";
  const parsed = new Date(value as string);
  if (Number.isNaN(parsed.getTime())) return "";
  return format(toZonedTime(parsed, TZ), "yyyy-MM-dd");
}

export function JobManageModal({
  job,
  open,
  onClose,
  onChanged,
}: {
  job: any | null;
  open: boolean;
  onClose: () => void;
  /** Called after any successful mutation so the board can reload. */
  onChanged: () => void | Promise<void>;
}) {
  const [section, setSection] = useState<Section>("schedule");

  // Schedule
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [reason, setReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);

  // Pricing & notes
  const [fixedPrice, setFixedPrice] = useState("");
  const [invoiceNote, setInvoiceNote] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [savingPricing, setSavingPricing] = useState(false);

  // Skip
  const [skipReason, setSkipReason] = useState("");
  const [skipBusy, setSkipBusy] = useState(false);

  // Danger
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dangerBusy, setDangerBusy] = useState(false);

  useEffect(() => {
    if (!open || !job) return;
    setSection("schedule");
    setDate(sydneyDateInput(job.scheduledDate));
    setStartTime(job.startTime ?? "");
    setDueTime(job.dueTime ?? "");
    setReason("");
    setFixedPrice(job.fixedPrice != null ? String(job.fixedPrice) : "");
    setInvoiceNote(job.invoiceNote ?? "");
    setInternalNotes(job.internalNotes ?? "");
    setSkipReason("");
  }, [open, job]);

  if (!job) return null;

  const skipStatus = String(job.cleanSkipStatus ?? "NONE");

  async function submitReschedule() {
    if (!date) {
      toast({ title: "Date required", variant: "destructive" });
      return;
    }
    setRescheduling(true);
    try {
      const res = await fetch(`/api/admin/phase4/reschedule/${job.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          startTime: startTime || null,
          dueTime: dueTime || null,
          reason: reason || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not reschedule.");
      toast({ title: "Job rescheduled" });
      onClose();
      await onChanged();
    } catch (err: any) {
      toast({ title: "Reschedule failed", description: err?.message ?? "Could not reschedule.", variant: "destructive" });
    } finally {
      setRescheduling(false);
    }
  }

  async function savePricing() {
    setSavingPricing(true);
    try {
      const payload: Record<string, unknown> = {
        fixedPrice: fixedPrice.trim() === "" ? null : Number(fixedPrice),
        invoiceNote: invoiceNote.trim() === "" ? null : invoiceNote.trim(),
      };
      if (internalNotes.trim() !== "" || (job.internalNotes ?? "") !== "") {
        payload.internalNotes = internalNotes;
      }
      if (payload.fixedPrice !== null && !Number.isFinite(payload.fixedPrice as number)) {
        throw new Error("Fixed price must be a number.");
      }
      const res = await fetch(`/api/admin/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? body.error ?? "Could not update job.");
      toast({ title: "Job updated" });
      onClose();
      await onChanged();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message ?? "Could not update job.", variant: "destructive" });
    } finally {
      setSavingPricing(false);
    }
  }

  async function runSkipAction(action: "set" | "approve" | "decline" | "unskip") {
    setSkipBusy(true);
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}/skip`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: skipReason.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update skip state.");
      toast({
        title:
          action === "set"
            ? "Clean skipped"
            : action === "approve"
              ? "Skip request approved"
              : action === "decline"
                ? "Skip request declined"
                : "Clean restored",
      });
      setSkipReason("");
      onClose();
      await onChanged();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message ?? "Could not update skip state.", variant: "destructive" });
    } finally {
      setSkipBusy(false);
    }
  }

  async function resetJob(credentials?: { pin?: string; password?: string }) {
    setDangerBusy(true);
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not reset job.");
      toast({ title: "Job reset", description: "Assignments and progress cleared; back to Unassigned." });
      setResetOpen(false);
      onClose();
      await onChanged();
    } catch (err: any) {
      toast({ title: "Reset failed", description: err?.message ?? "Could not reset job.", variant: "destructive" });
    } finally {
      setDangerBusy(false);
    }
  }

  async function deleteJob(credentials?: { pin?: string; password?: string }) {
    setDangerBusy(true);
    try {
      const res = await fetch(`/api/admin/jobs/${job.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not delete job.");
      toast({ title: "Job deleted" });
      setDeleteOpen(false);
      onClose();
      await onChanged();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message ?? "Could not delete job.", variant: "destructive" });
    } finally {
      setDangerBusy(false);
    }
  }

  return (
    <>
      <EModal open={open} onClose={onClose} title="Manage job" eyebrow={job.jobNumber ?? "Jobs"} size="wide">
        <div className="space-y-5">
          {/* Job summary strip */}
          <div className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.5)] px-3 py-2.5">
            <p className="e-serif min-w-0 truncate text-[0.9375rem] font-[520]">{job.property?.name ?? "Job"}</p>
            <EBadge tone={statusTone(String(job.status ?? ""))} soft>{statusLabel(String(job.status ?? ""))}</EBadge>
            {skipStatus === "REQUESTED" ? <EBadge tone="warning" soft>Skip requested</EBadge> : null}
            {skipStatus === "SKIPPED" ? <EBadge tone="danger" soft>Skipped</EBadge> : null}
          </div>

          {/* Section chips */}
          <div className="inline-flex flex-wrap items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? "page" : undefined}
                className={
                  "inline-flex items-center gap-1.5 rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors duration-[160ms] " +
                  (section === s.id
                    ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                    : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
                }
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>

          {section === "schedule" ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <EField label="Scheduled date">
                  <EInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </EField>
                <EField label="Start time">
                  <EInput type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </EField>
                <EField label="Due time">
                  <EInput type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
                </EField>
              </div>
              <EField label="Reason" hint="Recorded on the job timeline and used in cleaner notifications.">
                <ETextarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this moving?" />
              </EField>
              <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
                <EButton variant="outline" onClick={onClose} disabled={rescheduling}>Cancel</EButton>
                <EButton variant="gold" onClick={submitReschedule} disabled={rescheduling || !date}>
                  {rescheduling ? "Rescheduling…" : "Apply reschedule"}
                </EButton>
              </div>
            </div>
          ) : null}

          {section === "pricing" ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <EField label="Fixed client price (AUD)" hint="Leave empty to bill from the rate card.">
                  <EInput
                    type="number"
                    min="0"
                    step="0.01"
                    value={fixedPrice}
                    onChange={(e) => setFixedPrice(e.target.value)}
                    placeholder="Rate card"
                  />
                </EField>
                <EField label="Invoice note" hint="Printed on the client invoice line.">
                  <EInput value={invoiceNote} onChange={(e) => setInvoiceNote(e.target.value)} placeholder="Optional" />
                </EField>
              </div>
              <EField label="Internal note" hint="Visible to admin and assigned cleaners only.">
                <ETextarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} placeholder="Team-only context for this job" />
              </EField>
              <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
                <EButton variant="outline" onClick={onClose} disabled={savingPricing}>Cancel</EButton>
                <EButton variant="gold" onClick={savePricing} disabled={savingPricing}>
                  {savingPricing ? "Saving…" : "Save changes"}
                </EButton>
              </div>
            </div>
          ) : null}

          {section === "skip" ? (
            <div className="space-y-4">
              <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                {skipStatus === "REQUESTED"
                  ? "The client has asked to skip this clean. Approve or decline the request."
                  : skipStatus === "SKIPPED"
                    ? "This clean is currently skipped. Restore it to put the job back on the schedule."
                    : "Skip this clean without deleting the job — it stays on record but drops off dispatch."}
              </p>
              <EField label="Reason" hint="Optional note recorded against the skip decision.">
                <ETextarea value={skipReason} onChange={(e) => setSkipReason(e.target.value)} placeholder="e.g. Guest extended their stay" />
              </EField>
              <div className="flex flex-wrap justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
                {skipStatus === "REQUESTED" ? (
                  <>
                    <EButton variant="outline" onClick={() => runSkipAction("decline")} disabled={skipBusy}>
                      Decline request
                    </EButton>
                    <EButton variant="gold" onClick={() => runSkipAction("approve")} disabled={skipBusy}>
                      {skipBusy ? "Working…" : "Approve skip"}
                    </EButton>
                  </>
                ) : skipStatus === "SKIPPED" ? (
                  <EButton variant="gold" onClick={() => runSkipAction("unskip")} disabled={skipBusy}>
                    {skipBusy ? "Working…" : "Restore clean"}
                  </EButton>
                ) : (
                  <EButton variant="danger" onClick={() => runSkipAction("set")} disabled={skipBusy}>
                    {skipBusy ? "Working…" : "Skip this clean"}
                  </EButton>
                )}
              </div>
            </div>
          ) : null}

          {section === "danger" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-4 py-3">
                <div>
                  <p className="text-[0.875rem] font-[550]">Reset job</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Clears assignments and operational progress; the job returns to Unassigned.
                  </p>
                </div>
                <EButton variant="outline" onClick={() => setResetOpen(true)} disabled={dangerBusy}>Reset…</EButton>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.4)] px-4 py-3">
                <div>
                  <p className="text-[0.875rem] font-[550] text-[hsl(var(--e-danger))]">Delete job</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Permanently removes the job, its submissions, time logs and QA history.
                  </p>
                </div>
                <EButton variant="danger" onClick={() => setDeleteOpen(true)} disabled={dangerBusy}>Delete…</EButton>
              </div>
            </div>
          ) : null}
        </div>
      </EModal>

      <EConfirmModal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset this job?"
        description="Assignments, time logs and progress will be cleared and the job returns to Unassigned. Enter your PIN or password to continue."
        confirmLabel="Reset job"
        requireSecurity
        loading={dangerBusy}
        onConfirm={resetJob}
      />

      <EConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this job?"
        description="This permanently removes the job and its history. Enter your PIN or password to continue."
        confirmLabel="Delete job"
        confirmPhrase="DELETE"
        requireSecurity
        loading={dangerBusy}
        onConfirm={deleteJob}
      />
    </>
  );
}
