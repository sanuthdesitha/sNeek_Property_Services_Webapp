"use client";

/**
 * ESTATE job manage PANEL — per-job mutations, v2-native and at full v1
 * "Edit Job" parity. Every control reuses the exact same endpoint + payload as
 * the v1 console; only the presentation is Estate.
 *
 * This used to be a modal (`JobManageModal`) opened from a "Manage" button. It
 * was the ONLY way to edit a job in v2 — the detail page beneath it was a flat
 * stack of sixteen read-only cards — so every concern had two homes that
 * disagreed: schedule was page-read/modal-write, laundry sat on the page but
 * under *Billing* in the modal, and QA had a page panel but no modal section at
 * all. The modal is retired (owner decision, 2026-08); each section now renders
 * INLINE inside its matching tab on the detail page, one home per concern.
 *
 * Sections, selected by the `section` prop:
 *   · Schedule       date/start/due (POST /api/admin/phase4/reschedule/:id/apply)
 *                    + end time / completion (+1 day) / early-late presets
 *                      (PATCH /api/admin/jobs/:id — partial)
 *   · People & pay   status · allocated hours · per-cleaner transport allowance
 *                    + custom payout (PATCH /api/admin/jobs/:id — packs meta)
 *   · Scope & tasks  client notes · internal notes · tags · draft · admin
 *                    special-request tasks (PATCH) + save-as-template
 *                      (POST /api/admin/job-templates)
 *   · Billing        fixed price · invoice note (PATCH) + submission laundry
 *                      (PATCH /api/admin/form-submissions/:id) when a submission
 *                      exists on the job
 *   · Laundry        submission laundry ready/outcome/bag location
 *                      (PATCH /api/admin/form-submissions/:id). Split out of
 *                      Billing so it lives beside the job's laundry task rather
 *                      than under an unrelated heading.
 *   · Skip           set/approve/decline/unskip (PATCH /api/admin/jobs/:id/skip)
 *   · Danger         reset (POST) / delete (DELETE) — both security-verified
 *
 * Callers pass a rich job object (all scalars + assignments incl. userId /
 * payRate) plus a `submission` for the laundry controls. Everything degrades
 * gracefully when a field is absent.
 */
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import {
  EConfirmModal,
  EField,
  EInput,
  ESelect,
  ESwitch,
  ETextarea,
} from "@/components/v2/admin/estate-kit";
import {
  parseJobInternalNotes,
  type JobServiceContext,
  type JobSpecialRequestTask,
  type JobTimingPreset,
} from "@/lib/jobs/meta";
import type { JobNotice } from "@/lib/jobs/notices";
import { statusLabel } from "./job-row";
import { JobResetDialog } from "./job-reset-dialog";
import { JobPayCard } from "@/components/v2/shared/job-pay-card";

const TZ = "Australia/Sydney";

export type JobManageSection =
  | "schedule"
  | "people"
  | "scope"
  | "billing"
  | "laundry"
  | "skip"
  | "danger";

// v1's edit dropdown offers exactly this set (keys of STATUS_COLORS).
const JOB_STATUS_OPTIONS = [
  "UNASSIGNED",
  "OFFERED",
  "ASSIGNED",
  "IN_PROGRESS",
  "PAUSED",
  "WAITING_CONTINUATION_APPROVAL",
  "SUBMITTED",
  "QA_REVIEW",
  "COMPLETED",
  "INVOICED",
] as const;

const COMPLETED_STATUSES = new Set(["COMPLETED", "INVOICED"]);

function sydneyDateInput(value: unknown): string {
  if (!value) return "";
  const parsed = new Date(value as string);
  if (Number.isNaN(parsed.getTime())) return "";
  return format(toZonedTime(parsed, TZ), "yyyy-MM-dd");
}

function addOneDay(base: string): string {
  const d = new Date(`${base}T00:00:00`);
  if (Number.isNaN(d.getTime())) return base;
  d.setDate(d.getDate() + 1);
  return format(d, "yyyy-MM-dd");
}

function makeTaskId(): string {
  const suffix =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `admin-task-${suffix}`;
}

/** Build the earlyCheckin / lateCheckout payload the PATCH route expects. */
function rulePayload(preset: JobTimingPreset, time: string) {
  if (preset === "none") return { enabled: false, preset: "none" as const };
  return {
    enabled: true,
    preset,
    time: preset === "custom" ? time || undefined : undefined,
  };
}

export function JobManagePanel({
  job,
  section,
  onChanged,
}: {
  job: any | null;
  /** Which concern this panel is editing — set by the tab that renders it. */
  section: JobManageSection;
  /** Called after any successful mutation so the host can reload. */
  onChanged: () => void | Promise<void>;
}) {
  // Schedule — reschedule (separate endpoint)
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [reason, setReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);

  // Schedule — details (PATCH)
  const [endTime, setEndTime] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  const [earlyPreset, setEarlyPreset] = useState<JobTimingPreset>("none");
  const [earlyTime, setEarlyTime] = useState("");
  const [latePreset, setLatePreset] = useState<JobTimingPreset>("none");
  const [lateTime, setLateTime] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);

  // People & pay (PATCH)
  const [status, setStatus] = useState("UNASSIGNED");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [transportAllowances, setTransportAllowances] = useState<Record<string, string>>({});
  const [cleanerPayouts, setCleanerPayouts] = useState<Record<string, string>>({});
  const [savingPeople, setSavingPeople] = useState(false);

  // Scope & tasks (PATCH) + template (POST)
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [isDraft, setIsDraft] = useState(false);
  const [specialTasks, setSpecialTasks] = useState<JobSpecialRequestTask[]>([]);
  const [notices, setNotices] = useState<JobNotice[]>([]);
  const [keyPickupLocation, setKeyPickupLocation] = useState("");
  // Preserve the rest of serviceContext (access/parking/site-contact/etc.) so
  // saving key pickup doesn't wipe the other keys the PATCH route replaces.
  const [serviceContext, setServiceContext] = useState<JobServiceContext | undefined>(undefined);
  const [savingScope, setSavingScope] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Billing (PATCH) + laundry (form-submissions PATCH)
  const [fixedPrice, setFixedPrice] = useState("");
  const [invoiceNote, setInvoiceNote] = useState("");
  const [savingBilling, setSavingBilling] = useState(false);
  const [laundryReady, setLaundryReady] = useState<"unset" | "true" | "false">("unset");
  const [laundryOutcome, setLaundryOutcome] = useState("");
  const [bagLocation, setBagLocation] = useState("");
  const [savingLaundry, setSavingLaundry] = useState(false);

  // Skip
  const [skipReason, setSkipReason] = useState("");
  const [skipBusy, setSkipBusy] = useState(false);

  // Danger
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dangerBusy, setDangerBusy] = useState(false);

  // Assigned cleaners for the per-cleaner pay controls (present on both the
  // board list payload and the detail-page manage object).
  const cleaners = useMemo(() => {
    if (!Array.isArray(job?.assignments)) return [] as Array<{ id: string; name: string; isPrimary: boolean; payRate: number | null }>;
    return job.assignments
      .map((a: any) => ({
        id: (a?.userId ?? a?.user?.id ?? "") as string,
        name: (a?.user?.name ?? a?.user?.email ?? "Cleaner") as string,
        isPrimary: a?.isPrimary === true,
        payRate: typeof a?.payRate === "number" ? a.payRate : null,
      }))
      .filter((c: any) => c.id);
  }, [job]);

  const submission = job?.submission ?? (Array.isArray(job?.formSubmissions) ? job.formSubmissions[0] : null);
  const payHours =
    typeof job?.actualHours === "number"
      ? job.actualHours
      : typeof job?.estimatedHours === "number"
        ? job.estimatedHours
        : null;

  // Hydrate every field from the job. Re-runs when the server component
  // re-renders with fresh data after a save, so the inputs reflect what was
  // actually persisted rather than the last thing typed.
  useEffect(() => {
    if (!job) return;
    const meta = parseJobInternalNotes(job.internalNotes);

    // Schedule
    setDate(sydneyDateInput(job.scheduledDate));
    setStartTime(job.startTime ?? "");
    setDueTime(job.dueTime ?? "");
    setReason("");
    setEndTime(job.endTime ?? "");
    setCompletedAt(sydneyDateInput(job.completedAt));
    setEarlyPreset(meta.earlyCheckin.enabled ? meta.earlyCheckin.preset : "none");
    setEarlyTime(meta.earlyCheckin.preset === "custom" ? meta.earlyCheckin.time ?? "" : "");
    setLatePreset(meta.lateCheckout.enabled ? meta.lateCheckout.preset : "none");
    setLateTime(meta.lateCheckout.preset === "custom" ? meta.lateCheckout.time ?? "" : "");

    // People & pay
    setStatus(String(job.status ?? "UNASSIGNED"));
    setEstimatedHours(job.estimatedHours != null ? String(job.estimatedHours) : "");
    setTransportAllowances(
      Object.fromEntries(Object.entries(meta.transportAllowances).map(([id, amt]) => [id, String(amt)]))
    );
    setCleanerPayouts(
      Object.fromEntries(Object.entries(meta.cleanerPayouts).map(([id, amt]) => [id, String(amt)]))
    );

    // Scope & tasks
    setNotes(job.notes ?? "");
    setInternalNotes(meta.internalNoteText ?? "");
    setTagsText(meta.tags.join(", "));
    setIsDraft(meta.isDraft);
    setSpecialTasks(meta.specialRequestTasks.map((t) => ({ ...t })));
    setNotices(meta.notices.map((n) => ({ ...n })));
    setServiceContext(meta.serviceContext);
    setKeyPickupLocation(meta.serviceContext?.keyPickupLocation ?? "");
    setTemplateName(job.jobType ? `${String(job.jobType).replace(/_/g, " ")} template` : "Job template");

    // Billing
    setFixedPrice(job.fixedPrice != null ? String(job.fixedPrice) : "");
    setInvoiceNote(job.invoiceNote ?? "");

    // Laundry (submission)
    const sub = job.submission ?? (Array.isArray(job.formSubmissions) ? job.formSubmissions[0] : null);
    setLaundryReady(sub?.laundryReady === true ? "true" : sub?.laundryReady === false ? "false" : "unset");
    setLaundryOutcome(sub?.laundryOutcome ? String(sub.laundryOutcome) : "");
    setBagLocation(sub?.bagLocation ?? "");

    setSkipReason("");
  }, [job]);

  if (!job) return null;

  const skipStatus = String(job.cleanSkipStatus ?? "NONE");

  /** Shared PATCH helper for the /api/admin/jobs/:id partial update. */
  async function patchJob(payload: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/admin/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message ?? body.error ?? "Could not update job.");
    return true;
  }

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
      await onChanged();
    } catch (err: any) {
      toast({ title: "Reschedule failed", description: err?.message ?? "Could not reschedule.", variant: "destructive" });
    } finally {
      setRescheduling(false);
    }
  }

  async function saveScheduleDetails() {
    setSavingSchedule(true);
    try {
      await patchJob({
        endTime: endTime || undefined,
        completedAt: completedAt ? `${completedAt}T00:00:00.000Z` : null,
        earlyCheckin: rulePayload(earlyPreset, earlyTime),
        lateCheckout: rulePayload(latePreset, lateTime),
      });
      toast({ title: "Schedule details saved" });
      await onChanged();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message ?? "Could not update job.", variant: "destructive" });
    } finally {
      setSavingSchedule(false);
    }
  }

  async function savePeople() {
    setSavingPeople(true);
    try {
      // Moving a completed/invoiced job back to Unassigned needs an explicit
      // confirm (the server otherwise 409s CONFIRM_COMPLETED_RESET_REQUIRED).
      const needsResetConfirm =
        status === "UNASSIGNED" && COMPLETED_STATUSES.has(String(job.status ?? ""));
      if (
        needsResetConfirm &&
        !window.confirm("This job is completed/invoiced. Move it back to Unassigned? Assignments will be cleared.")
      ) {
        setSavingPeople(false);
        return;
      }

      const transport = Object.entries(transportAllowances).reduce<Record<string, number>>((acc, [id, raw]) => {
        const amount = Number(raw);
        if (id.trim() && Number.isFinite(amount) && amount > 0) acc[id.trim()] = Number(amount.toFixed(2));
        return acc;
      }, {});
      const payouts = Object.entries(cleanerPayouts).reduce<Record<string, number>>((acc, [id, raw]) => {
        const text = String(raw ?? "").trim();
        if (text === "") return acc; // blank = pay normally
        const amount = Number(text);
        if (id.trim() && Number.isFinite(amount) && amount >= 0) acc[id.trim()] = Number(amount.toFixed(2));
        return acc;
      }, {});

      await patchJob({
        status,
        estimatedHours: estimatedHours.trim() === "" ? undefined : Number(estimatedHours),
        transportAllowances: transport,
        cleanerPayouts: payouts,
        ...(needsResetConfirm ? { confirmCompletedReset: true } : {}),
      });
      toast({ title: "Job updated" });
      await onChanged();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message ?? "Could not update job.", variant: "destructive" });
    } finally {
      setSavingPeople(false);
    }
  }

  async function saveScope() {
    setSavingScope(true);
    try {
      await patchJob({
        notes: notes || undefined,
        internalNotes: internalNotes || undefined,
        isDraft,
        tags: tagsText.split(",").map((v) => v.trim()).filter(Boolean),
        // Merge onto the preserved serviceContext so other access keys survive
        // (the PATCH route replaces serviceContext wholesale with what we send).
        serviceContext: {
          ...(serviceContext ?? {}),
          keyPickupLocation: keyPickupLocation.trim() || undefined,
        },
        notices: notices
          .map((n) => ({ id: n.id, body: n.body.trim(), urgency: n.urgency }))
          .filter((n) => n.body.length > 0),
        specialRequestTasks: specialTasks
          .map((t) => ({
            ...t,
            title: t.title.trim(),
            description: t.description?.trim() || undefined,
          }))
          .filter((t) => t.title.length > 0),
      });
      toast({ title: "Job scope saved" });
      await onChanged();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message ?? "Could not update job.", variant: "destructive" });
    } finally {
      setSavingScope(false);
    }
  }

  async function saveTemplate() {
    if (!templateName.trim()) {
      toast({ title: "Template name is required.", variant: "destructive" });
      return;
    }
    setSavingTemplate(true);
    try {
      const meta = parseJobInternalNotes(job.internalNotes);
      const res = await fetch("/api/admin/job-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: templateName.trim(),
          jobType: job.jobType,
          startTime: startTime || undefined,
          dueTime: dueTime || undefined,
          endTime: endTime || undefined,
          estimatedHours: estimatedHours ? Number(estimatedHours) : undefined,
          notes: notes || undefined,
          internalNotes: internalNotes || undefined,
          isDraft,
          tags: tagsText.split(",").map((v) => v.trim()).filter(Boolean),
          attachments: meta.attachments,
          earlyCheckin: rulePayload(earlyPreset, earlyTime),
          lateCheckout: rulePayload(latePreset, lateTime),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save template.");
      toast({ title: "Template saved" });
    } catch (err: any) {
      toast({ title: "Template save failed", description: err?.message ?? "Could not save template.", variant: "destructive" });
    } finally {
      setSavingTemplate(false);
    }
  }

  async function saveBilling() {
    setSavingBilling(true);
    try {
      const nextPrice = fixedPrice.trim() === "" ? null : Number(fixedPrice);
      if (nextPrice !== null && !Number.isFinite(nextPrice)) {
        throw new Error("Fixed price must be a number.");
      }
      await patchJob({
        fixedPrice: nextPrice,
        invoiceNote: invoiceNote.trim() === "" ? null : invoiceNote.trim(),
      });
      toast({ title: "Billing updated" });
      await onChanged();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message ?? "Could not update job.", variant: "destructive" });
    } finally {
      setSavingBilling(false);
    }
  }

  async function saveLaundry() {
    if (!submission?.id) return;
    setSavingLaundry(true);
    try {
      const res = await fetch(`/api/admin/form-submissions/${submission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          laundryReady: laundryReady === "unset" ? null : laundryReady === "true",
          laundryOutcome: laundryOutcome || null,
          bagLocation: bagLocation.trim() === "" ? null : bagLocation.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not update submission.");
      toast({ title: "Laundry details saved" });
      await onChanged();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message ?? "Could not update submission.", variant: "destructive" });
    } finally {
      setSavingLaundry(false);
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
      await onChanged();
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message ?? "Could not update skip state.", variant: "destructive" });
    } finally {
      setSkipBusy(false);
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
      await onChanged();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message ?? "Could not delete job.", variant: "destructive" });
    } finally {
      setDangerBusy(false);
    }
  }

  return (
    <>
      <div className="space-y-5">
          {/* ── Schedule ─────────────────────────────────────────────────── */}
          {section === "schedule" ? (
            <div className="space-y-5">
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
                <div className="flex justify-end">
                  <EButton variant="gold" onClick={submitReschedule} disabled={rescheduling || !date}>
                    {rescheduling ? "Rescheduling…" : "Apply reschedule"}
                  </EButton>
                </div>
              </div>

              <div className="space-y-4 border-t border-[hsl(var(--e-border))] pt-5">
                <p className="text-[0.75rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                  Schedule details
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <EField label="End time" hint="Actual finish time, alongside start / due.">
                    <EInput type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                  </EField>
                  <EField
                    label="Completion date"
                    hint="Sets the pay & invoice period. Blank stamps automatically when QA passes."
                  >
                    <div className="flex gap-2">
                      <EInput type="date" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} />
                      <EButton
                        variant="outline"
                        onClick={() => setCompletedAt((prev) => addOneDay(prev || date))}
                        disabled={!completedAt && !date}
                        className="shrink-0"
                      >
                        +1 day
                      </EButton>
                    </div>
                  </EField>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <EField label="Early check-in" hint="Airbnb: finish the clean before this time.">
                    <div className="flex gap-2">
                      <ESelect value={earlyPreset} onChange={(e) => setEarlyPreset(e.target.value as JobTimingPreset)}>
                        <option value="none">None</option>
                        <option value="11:00">Before 11:00 AM</option>
                        <option value="12:30">Before 12:30 PM</option>
                        <option value="custom">Custom</option>
                      </ESelect>
                      {earlyPreset === "custom" ? (
                        <EInput type="time" value={earlyTime} onChange={(e) => setEarlyTime(e.target.value)} className="w-32 shrink-0" />
                      ) : null}
                    </div>
                  </EField>
                  <EField label="Late checkout" hint="Airbnb: start the clean after this time.">
                    <div className="flex gap-2">
                      <ESelect value={latePreset} onChange={(e) => setLatePreset(e.target.value as JobTimingPreset)}>
                        <option value="none">None</option>
                        <option value="12:30">Start after 12:30 PM</option>
                        <option value="custom">Custom</option>
                      </ESelect>
                      {latePreset === "custom" ? (
                        <EInput type="time" value={lateTime} onChange={(e) => setLateTime(e.target.value)} className="w-32 shrink-0" />
                      ) : null}
                    </div>
                  </EField>
                </div>
                <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
                  <EButton variant="gold" onClick={saveScheduleDetails} disabled={savingSchedule}>
                    {savingSchedule ? "Saving…" : "Save schedule details"}
                  </EButton>
                </div>
              </div>
            </div>
          ) : null}

          {/* ── People & pay ─────────────────────────────────────────────── */}
          {section === "people" ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <EField label="Status" hint="Move the job directly through its lifecycle.">
                  <ESelect value={status} onChange={(e) => setStatus(e.target.value)}>
                    {JOB_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{statusLabel(s)}</option>
                    ))}
                  </ESelect>
                </EField>
                <EField label="Allocated / fixed pay hours" hint="Drives hours × rate pay when no custom payout is set.">
                  <EInput
                    type="number"
                    min="0"
                    step="0.25"
                    value={estimatedHours}
                    onChange={(e) => setEstimatedHours(e.target.value)}
                    placeholder="e.g. 3"
                  />
                </EField>
              </div>

              <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="text-[0.8125rem] font-[550]">Per-cleaner pay</p>
                {cleaners.length === 0 ? (
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Assign cleaners to this job to set transport allowance or a custom payout per cleaner.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {cleaners.map((c: { id: string; name: string; isPrimary: boolean; payRate: number | null }) => (
                      <div key={c.id} className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[0.8125rem] font-[550]">{c.name}</span>
                          {c.isPrimary ? <EBadge tone="neutral" soft>Primary</EBadge> : null}
                          {c.payRate != null && payHours != null ? (
                            <span className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                              est. ${(c.payRate * payHours).toFixed(2)} ({c.payRate}/h × {payHours}h)
                            </span>
                          ) : null}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <EField label="Transport allowance (AUD)" hint="Added on top of pay. Blank = none.">
                            <EInput
                              type="number"
                              min="0"
                              step="0.01"
                              value={transportAllowances[c.id] ?? ""}
                              onChange={(e) =>
                                setTransportAllowances((prev) => ({ ...prev, [c.id]: e.target.value }))
                              }
                              placeholder="0.00"
                            />
                          </EField>
                          <EField
                            label="Fixed pay (AUD)"
                            hint="A flat amount for this job — replaces hours × rate entirely, and the invoice prints it as Fixed. Blank = pay normally, 0 = pay nothing."
                          >
                            <EInput
                              type="number"
                              min="0"
                              step="0.01"
                              value={cleanerPayouts[c.id] ?? ""}
                              onChange={(e) =>
                                setCleanerPayouts((prev) => ({ ...prev, [c.id]: e.target.value }))
                              }
                              placeholder="Auto"
                            />
                          </EField>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
                <EButton variant="gold" onClick={savePeople} disabled={savingPeople}>
                  {savingPeople ? "Saving…" : "Save changes"}
                </EButton>
              </div>

            </div>
          ) : null}

          {/* ── Scope & tasks ────────────────────────────────────────────── */}
          {section === "scope" ? (
            <div className="space-y-4">
              <EField label="Client-facing notes" hint="Visible to the client on their portal and confirmations.">
                <ETextarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes shared with the client" />
              </EField>
              <EField label="Internal note" hint="Visible to admin and assigned cleaners only.">
                <ETextarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} placeholder="Team-only context for this job" />
              </EField>
              <EField label="Key pickup location" hint="Where the cleaner collects keys, if not a lockbox at the property.">
                <EInput
                  value={keyPickupLocation}
                  onChange={(e) => setKeyPickupLocation(e.target.value)}
                  placeholder="e.g. Reception desk, neighbour at #4, office safe."
                />
              </EField>
              <div className="grid gap-4 sm:grid-cols-2">
                <EField label="Tags" hint="Comma-separated, free text.">
                  <EInput value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="e.g. deep-clean, VIP" />
                </EField>
                <EField label="Draft" hint="Draft jobs stay off dispatch until published.">
                  <div className="flex h-10 items-center">
                    <ESwitch checked={isDraft} onCheckedChange={setIsDraft} label={isDraft ? "Draft" : "Live"} />
                  </div>
                </EField>
              </div>

              {/* Notices — information, not work. Kept separate from the task
                  editor below because a notice must never count as an
                  outstanding task or drag a job's completion percentage down. */}
              <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[0.8125rem] font-[550]">Notices for the cleaner</p>
                  <EButton
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setNotices((prev) => [
                        ...prev,
                        { id: makeTaskId(), body: "", urgency: "INFO" },
                      ])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> Add notice
                  </EButton>
                </div>
                {notices.length === 0 ? (
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    One-off information for this clean — a gate code change, a dog inside, a lift
                    out of service. Shown when the cleaner opens the job and again at start.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {notices.map((notice, index) => (
                      <div
                        key={notice.id}
                        className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5"
                      >
                        <div className="flex items-start gap-2">
                          <ETextarea
                            value={notice.body}
                            onChange={(e) =>
                              setNotices((prev) =>
                                prev.map((n) =>
                                  n.id === notice.id ? { ...n, body: e.target.value } : n
                                )
                              )
                            }
                            placeholder={`Notice ${index + 1}`}
                            className="min-h-[3rem]"
                          />
                          <EButton
                            variant="ghost"
                            size="icon"
                            onClick={() => setNotices((prev) => prev.filter((n) => n.id !== notice.id))}
                            aria-label="Remove notice"
                            className="shrink-0"
                          >
                            <Trash2 className="h-4 w-4" />
                          </EButton>
                        </div>
                        <div className="flex flex-wrap items-center gap-4">
                          <ESwitch
                            checked={notice.urgency === "IMPORTANT"}
                            onCheckedChange={(v) =>
                              setNotices((prev) =>
                                prev.map((n) =>
                                  n.id === notice.id
                                    ? { ...n, urgency: v ? "IMPORTANT" : "INFO" }
                                    : n
                                )
                              )
                            }
                            label="Important"
                          />
                          {notice.authorName || notice.createdAt ? (
                            <span className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                              {notice.authorName ? `Added by ${notice.authorName}` : "Added"}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[0.8125rem] font-[550]">Admin special-request tasks</p>
                  <EButton
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSpecialTasks((prev) => [
                        ...prev,
                        { id: makeTaskId(), title: "", description: "", requiresPhoto: false, requiresNote: false },
                      ])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> Add task
                  </EButton>
                </div>
                {specialTasks.length === 0 ? (
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Per-job required tasks the cleaner must complete (with optional photo / note proof).
                  </p>
                ) : (
                  <div className="space-y-3">
                    {specialTasks.map((task, index) => (
                      <div key={task.id} className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <EInput
                            value={task.title}
                            onChange={(e) =>
                              setSpecialTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, title: e.target.value } : t)))
                            }
                            placeholder={`Task ${index + 1} title`}
                          />
                          <EButton
                            variant="ghost"
                            size="icon"
                            onClick={() => setSpecialTasks((prev) => prev.filter((t) => t.id !== task.id))}
                            aria-label="Remove task"
                            className="shrink-0"
                          >
                            <Trash2 className="h-4 w-4" />
                          </EButton>
                        </div>
                        <ETextarea
                          value={task.description ?? ""}
                          onChange={(e) =>
                            setSpecialTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, description: e.target.value } : t)))
                          }
                          placeholder="Instructions (optional)"
                          className="min-h-[3rem]"
                        />
                        <div className="flex flex-wrap gap-4">
                          <ESwitch
                            checked={task.requiresPhoto}
                            onCheckedChange={(v) =>
                              setSpecialTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, requiresPhoto: v } : t)))
                            }
                            label="Requires photo"
                          />
                          <ESwitch
                            checked={task.requiresNote}
                            onCheckedChange={(v) =>
                              setSpecialTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, requiresNote: v } : t)))
                            }
                            label="Requires note"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
                <EButton variant="gold" onClick={saveScope} disabled={savingScope}>
                  {savingScope ? "Saving…" : "Save scope"}
                </EButton>
              </div>

              <div className="space-y-3 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] p-3">
                <p className="text-[0.8125rem] font-[550]">Save job as template</p>
                <div className="flex flex-wrap items-end gap-2">
                  <EField label="Template name" className="min-w-[16rem] flex-1">
                    <EInput value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name" />
                  </EField>
                  <EButton variant="outline" onClick={saveTemplate} disabled={savingTemplate}>
                    {savingTemplate ? "Saving…" : "Save template"}
                  </EButton>
                </div>
                <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                  Captures the current times, hours, notes, tags, draft flag and turnaround presets for reuse.
                </p>
              </div>
            </div>
          ) : null}

          {/* ── Billing ──────────────────────────────────────────────────── */}
          {section === "billing" ? (
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
              <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
                <EButton variant="gold" onClick={saveBilling} disabled={savingBilling}>
                  {savingBilling ? "Saving…" : "Save billing"}
                </EButton>
              </div>

              {/* Canonical per-payee pay summary: base + every adjustment
                  (automatic or manual, editable in place when unsettled) + the
                  exact total the invoice/payroll will pay. It belongs beside
                  the money, not under People. */}
              <JobPayCard jobId={String(job.id)} />
            </div>
          ) : null}

          {/* ── Laundry ──────────────────────────────────────────────────────
              Its own section rather than a block inside Billing: the job's
              laundry task lives on the Laundry tab, and having the only way to
              CORRECT the outcome sit under "Billing" is exactly the kind of
              split home this refactor exists to remove. */}
          {section === "laundry" ? (
            <div className="space-y-4">
              <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="text-[0.8125rem] font-[550]">Submission laundry</p>
                {!submission?.id ? (
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    No job-form submission yet — laundry outcome becomes editable once the cleaner submits.
                  </p>
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <EField label="Laundry ready">
                        <ESelect value={laundryReady} onChange={(e) => setLaundryReady(e.target.value as any)}>
                          <option value="unset">Not set</option>
                          <option value="true">Ready</option>
                          <option value="false">Not ready</option>
                        </ESelect>
                      </EField>
                      <EField label="Outcome">
                        <ESelect value={laundryOutcome} onChange={(e) => setLaundryOutcome(e.target.value)}>
                          <option value="">Not set</option>
                          <option value="READY_FOR_PICKUP">Ready for pickup</option>
                          <option value="NOT_READY">Not ready</option>
                          <option value="NO_PICKUP_REQUIRED">No pickup required</option>
                        </ESelect>
                      </EField>
                      <EField label="Bag location">
                        <EInput value={bagLocation} onChange={(e) => setBagLocation(e.target.value)} placeholder="e.g. Front porch" />
                      </EField>
                    </div>
                    <div className="flex justify-end">
                      <EButton variant="outline" onClick={saveLaundry} disabled={savingLaundry}>
                        {savingLaundry ? "Saving…" : "Save laundry"}
                      </EButton>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : null}

          {/* Messages used to be a section here AND a card on the detail page —
              the same thread rendered twice. The card is the one home now. */}

          {/* ── Skip ─────────────────────────────────────────────────────── */}
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

          {/* ── Danger ───────────────────────────────────────────────────── */}
          {section === "danger" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-4 py-3">
                <div>
                  <p className="text-[0.875rem] font-[550]">Reset job</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Choose what to reset. By default only the status and start/progress markers are cleared —
                    time logs, assignees, forms, photos and pay are kept.
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

      <JobResetDialog
        open={resetOpen}
        jobId={job.id}
        onClose={() => setResetOpen(false)}
        onDone={async () => {
          toast({ title: "Job reset" });
          await onChanged();
        }}
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
