"use client";

/**
 * THE assign dialog (board "Everyday dialogs and sheets", 2026-11). One
 * window for every entry point that used to have its own:
 *
 *   - "job"  (Jobs list quick assign, job page, Calendar): pick cleaners, star
 *     the primary. POST /api/admin/jobs/:id/assign
 *     { userIds, primaryUserId?, confirmLeaveConflict? } — the same body as
 *     before; an empty list clears every assignee.
 *   - "bulk" (Jobs bulk bar): one cleaner for the selected jobs.
 *     POST /api/admin/jobs/bulk-assign { jobIds, cleanerUserId, confirmLeaveConflict? }.
 *
 * Leave and an expired police check or visa are read first (read only,
 * GET /api/admin/jobs/assign-facts) and shown in the list, so a clash is seen
 * before Save. Cleaners with a warning stay in the list, marked. Choosing one
 * turns the button into "Assign anyway", which sends the existing explicit
 * override; the server still re-checks, answers 409 for anything the list did
 * not know, and audits every override (ASSIGNMENT_WARNING_OVERRIDDEN).
 *
 * The draft (ticks, primary, search) survives closing and is dropped when the
 * dialog opens for another job or selection. Fields freeze while saving; a
 * failed save keeps the draft and says why. A late facts answer for other jobs
 * is ignored.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Star, TriangleAlert } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { ENote } from "@/components/v2/ui/form-dialog-parts";
import { EButton } from "@/components/v2/ui/primitives";
import { toneRowCellClass } from "@/components/v2/ui/tone-band";
import { assignFactsResponseSchema, type AssignFactWarning, type AssignFactsResponse } from "@/lib/jobs/assign-facts-types";
import { ReassignNoteDialog, parseReassignPreview, type ReassignPreview } from "./reassign-note-dialog";

export type AssignCleaner = { id: string; name: string; email: string };

export type AssignTarget =
  | {
      kind: "job";
      jobId: string;
      /** Context line above the title: "J-1088 · Glebe House · Sat 21 Nov 10:00". */
      context: string;
      /** Phone sheet title: "Assign · Glebe House, Sat 21 Nov". */
      phoneTitle?: string;
      initialAssignedIds?: string[];
      initialPrimaryId?: string | null;
    }
  | { kind: "bulk"; jobIds: string[]; context: string };

type AssignDialogProps = {
  open: boolean;
  target: AssignTarget | null;
  cleaners: AssignCleaner[];
  /** Whether the caller's cleaner list loaded; "ready" when omitted. */
  cleanersState?: "loading" | "failed" | "ready";
  onClose: () => void;
  /** After a successful save. `updated` is the bulk route's count (job mode: 1). */
  onAssigned: (updated: number) => void | Promise<void>;
};

type Facts = { status: "loading" } | { status: "failed" } | { status: "ready"; data: AssignFactsResponse };
type Draft = { key: string; selected: string[]; primary: string | null; search: string };

function targetKey(target: AssignTarget | null): string {
  if (!target) return "";
  return target.kind === "job" ? `job:${target.jobId}` : `bulk:${[...target.jobIds].sort().join(",")}`;
}

function initialDraft(target: AssignTarget | null): Draft {
  const selected = target?.kind === "job" ? [...(target.initialAssignedIds ?? [])] : [];
  const primary = target?.kind === "job" ? target.initialPrimaryId ?? selected[0] ?? null : null;
  return { key: targetKey(target), selected, primary, search: "" };
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "")).toUpperCase() || "?";
}

function warningLabel(warning: AssignFactWarning): string {
  if (warning.kind === "leave") return warning.text;
  const text = warning.text.charAt(0).toUpperCase() + warning.text.slice(1);
  return text;
}

/** The facts for one cleaner, folded for display ("On leave 19–23 Nov" or "On leave on 2 of 5 jobs"). */
function cleanerWarnings(facts: Facts, userId: string, jobCount: number): string[] {
  if (facts.status !== "ready") return [];
  const row = facts.data.cleaners.find((cleaner) => cleaner.userId === userId);
  if (!row || row.warnings.length === 0) return [];
  if (jobCount <= 1) return Array.from(new Set(row.warnings.map(warningLabel)));
  const byKind = new Map<AssignFactWarning["kind"], Set<string>>();
  for (const warning of row.warnings) byKind.set(warning.kind, (byKind.get(warning.kind) ?? new Set()).add(warning.jobId));
  const noun: Record<AssignFactWarning["kind"], string> = { leave: "On leave", police_check: "Police check expired", visa: "Visa expired" };
  return Array.from(byKind.entries()).map(([kind, jobs]) => `${noun[kind]} on ${jobs.size} of ${jobCount} jobs`);
}

function hasLeave(facts: Facts, userId: string): boolean {
  return facts.status === "ready" && Boolean(facts.data.cleaners.find((row) => row.userId === userId)?.warnings.some((warning) => warning.kind === "leave"));
}

function otherJobsLabel(facts: Facts, userId: string): string | null {
  if (facts.status !== "ready") return null;
  const count = facts.data.cleaners.find((row) => row.userId === userId)?.otherJobsThatDay;
  if (count === null || count === undefined) return null;
  return count === 0 ? "Free that day" : `${count} other job${count === 1 ? "" : "s"} that day`;
}

export function AssignDialog({ open, target, cleaners, cleanersState = "ready", onClose, onAssigned }: AssignDialogProps) {
  const key = targetKey(target);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(target));
  const [facts, setFacts] = useState<Facts>({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reassign, setReassign] = useState<ReassignPreview | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;

  // A different job or selection drops the old draft; the same one keeps it.
  useEffect(() => {
    if (!open || draft.key === key) return;
    setDraft(initialDraft(targetRef.current));
    setRefusal(null);
    setFailure(null);
  }, [open, key, draft.key]);

  // Leave and documents for these jobs; a late answer for other jobs is dropped.
  const jobIds = target ? (target.kind === "job" ? [target.jobId] : target.jobIds) : [];
  const jobIdsKey = jobIds.join(",");
  useEffect(() => {
    if (!open || !jobIdsKey) return;
    const controller = new AbortController();
    setFacts({ status: "loading" });
    fetch(`/api/admin/jobs/assign-facts?jobIds=${encodeURIComponent(jobIdsKey)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        const parsed = assignFactsResponseSchema.safeParse(body);
        setFacts(response.ok && parsed.success ? { status: "ready", data: parsed.data } : { status: "failed" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setFacts({ status: "failed" });
      });
    return () => controller.abort();
  }, [open, jobIdsKey]);

  const bulk = target?.kind === "bulk";
  const jobCount = jobIds.length;
  const initialIds = target?.kind === "job" ? target.initialAssignedIds ?? [] : [];
  const initialPrimary = target?.kind === "job" ? target.initialPrimaryId ?? initialIds[0] ?? null : null;
  const selected = draft.key === key ? draft.selected : initialDraft(target).selected;
  const primary = draft.key === key ? draft.primary : initialDraft(target).primary;
  const search = draft.key === key ? draft.search : "";

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return cleaners;
    return cleaners.filter((cleaner) => `${cleaner.name} ${cleaner.email}`.toLowerCase().includes(term));
  }, [cleaners, search]);

  // Only newly added cleaners are checked by the server, so only they warn.
  const warned = selected
    .filter((id) => bulk || !initialIds.includes(id))
    .map((id) => ({ id, name: cleaners.find((cleaner) => cleaner.id === id)?.name || "Cleaner", lines: cleanerWarnings(facts, id, jobCount) }))
    .filter((row) => row.lines.length > 0);
  const needsOverride = warned.length > 0 || refusal !== null;

  const dirty = bulk
    ? selected.length === 1
    : [...initialIds].sort().join(",") !== [...selected].sort().join(",") || (selected.length > 0 && (primary ?? selected[0]) !== initialPrimary);

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...(current.key === key ? current : initialDraft(target)), ...next }));
  }

  function toggle(id: string) {
    setRefusal(null);
    setFailure(null);
    if (bulk) {
      patch({ selected: selected[0] === id ? [] : [id] });
      return;
    }
    const next = selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
    patch({ selected: next, primary: next.includes(primary ?? "") ? primary : next[0] ?? null });
  }

  async function submit() {
    if (!target || saving || !dirty) return;
    const confirmLeaveConflict = needsOverride;
    setSaving(true);
    setFailure(null);
    try {
      const request = target.kind === "job"
        ? { url: `/api/admin/jobs/${target.jobId}/assign`, body: { userIds: selected, primaryUserId: selected.length > 0 ? primary ?? selected[0] : undefined, ...(confirmLeaveConflict ? { confirmLeaveConflict: true } : {}) } }
        : { url: "/api/admin/jobs/bulk-assign", body: { jobIds: target.jobIds, cleanerUserId: selected[0], ...(confirmLeaveConflict ? { confirmLeaveConflict: true } : {}) } };
      const response = await fetch(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.status === 409 && body.code === "LEAVE_CONFLICT") {
        setRefusal(typeof body.error === "string" && body.error ? body.error : "A chosen cleaner is on leave or has an expired document that day.");
        return;
      }
      if (!response.ok) {
        setFailure(typeof body.error === "string" && body.error ? body.error : "The assignment was not saved.");
        return;
      }
      const updated = target.kind === "bulk" ? Number(body.updated ?? target.jobIds.length) : 1;
      toast(target.kind === "bulk"
        ? { title: "Bulk assignment complete", description: `${updated} jobs updated.` }
        : selected.length === 0
          ? { title: "Assignees cleared", description: "This job is now unassigned." }
          : { title: "Assignment saved", description: `${selected.length} cleaner${selected.length === 1 ? "" : "s"} assigned.` });
      setDraft({ key: "", selected: [], primary: null, search: "" });
      setRefusal(null);
      onClose();
      await onAssigned(updated);
      // A replaced primary: the server prepared the client note instead of sending it (unchanged).
      const preview = target.kind === "job" ? parseReassignPreview(body, target.jobId) : null;
      if (preview) setReassign(preview);
    } catch {
      setFailure("Could not reach the server. Nothing is known to have changed; your choice is kept, so try again.");
    } finally {
      setSaving(false);
    }
  }

  if (reassign) return <ReassignNoteDialog preview={reassign} onClose={() => setReassign(null)} />;
  if (!target) return null;

  const count = selected.length;
  const clearing = !bulk && count === 0 && initialIds.length > 0;
  const primaryLabel = saving
    ? "Assigning…"
    : needsOverride
      ? "Assign anyway"
      : clearing
        ? "Clear assignees"
        : bulk
          ? `Assign to ${jobCount} job${jobCount === 1 ? "" : "s"}`
          : `Assign ${count}`;
  const phoneLabel = saving || needsOverride || clearing || bulk ? primaryLabel : `Assign ${count} cleaner${count === 1 ? "" : "s"}`;

  return (
    <EActionDialog
      open={open}
      layout="form"
      eyebrow={target.context}
      title={bulk ? "Assign a cleaner" : "Assign cleaners"}
      phoneTitle={target.kind === "job" ? target.phoneTitle : undefined}
      busy={saving}
      onClose={onClose}
      footerNote={(
        <>
          <span className="max-sm:hidden">{bulk ? "Unassigned jobs move to Assigned. They are told as today." : "They are told as today."}</span>
          <span className="sm:hidden">Closing keeps your ticks until you open another job.</span>
        </>
      )}
      footer={(
        <>
          <EButton variant="outline" size="sm" className="max-sm:hidden" onClick={onClose} disabled={saving}>Cancel</EButton>
          <EButton size="sm" onClick={() => void submit()} disabled={saving || !dirty}>
            <span className="max-sm:hidden">{primaryLabel}</span>
            <span className="sm:hidden">{phoneLabel}</span>
          </EButton>
        </>
      )}
    >
      <fieldset disabled={saving} className="min-w-0 space-y-3">
        <label className="block">
          <span className="sr-only">Search cleaners</span>
          <input
            type="search"
            value={search}
            onChange={(event) => patch({ search: event.target.value })}
            placeholder="Search cleaners"
            className="h-10 w-full rounded-[10px] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.875rem] max-sm:h-11 max-sm:text-[1rem]"
          />
        </label>
        {facts.status === "loading" ? <p role="status" className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Checking leave and documents…</p> : null}
        {facts.status === "failed" ? (
          <ENote tone="attention" role="status">Leave and documents could not be checked. The server still checks them when you save.</ENote>
        ) : null}
        <ul aria-label={bulk ? "Choose one cleaner" : "Cleaners"} className="max-h-72 space-y-1.5 overflow-y-auto max-sm:max-h-none">
          {cleanersState === "loading" ? (
            <li role="status" className="py-4 text-center text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Loading cleaners…</li>
          ) : cleanersState === "failed" ? (
            <li role="alert" className="py-4 text-center text-[0.8125rem] text-[hsl(var(--e-band-problem-fg))]">The cleaners could not be loaded. Close and open again to retry.</li>
          ) : cleaners.length === 0 ? (
            <li className="py-4 text-center text-[0.8125rem] text-[hsl(var(--e-text-faint))]">No active cleaner accounts.</li>
          ) : visible.length === 0 ? (
            <li className="py-4 text-center text-[0.8125rem] text-[hsl(var(--e-text-faint))]">No cleaner matches &ldquo;{search}&rdquo;.</li>
          ) : visible.map((cleaner) => {
            const checked = selected.includes(cleaner.id);
            const isPrimary = !bulk && checked && (primary ?? selected[0]) === cleaner.id;
            const lines = cleanerWarnings(facts, cleaner.id, jobCount);
            const leave = hasLeave(facts, cleaner.id);
            const sub = otherJobsLabel(facts, cleaner.id) ?? cleaner.email;
            const name = cleaner.name || cleaner.email;
            return (
              <li
                key={cleaner.id}
                className={cn(
                  "flex min-h-[3.25rem] items-center gap-3 rounded-[10px] border px-3 py-2",
                  leave ? cn(toneRowCellClass("attention"), "border-[hsl(var(--e-band-attention-line))]") : checked ? "border-[hsl(var(--e-primary)/0.4)] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))]",
                )}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type={bulk ? "radio" : "checkbox"}
                    name={bulk ? "assign-bulk-cleaner" : undefined}
                    checked={checked}
                    onChange={() => toggle(cleaner.id)}
                    className="h-5 w-5 shrink-0 accent-[hsl(var(--e-primary))]"
                  />
                  <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--e-muted))] text-[0.6875rem] font-[650]">{initials(name)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[0.875rem] font-[600]">{name}</span>
                    {lines.length > 0 ? lines.map((line) => (
                      <span key={line} className={cn("flex items-center gap-1 text-[0.75rem] font-[550]", leave ? "text-[hsl(var(--e-band-attention-fg))]" : "text-[hsl(var(--e-band-problem-fg))]")}>
                        <TriangleAlert aria-hidden className="h-3 w-3 shrink-0" />{line}
                      </span>
                    )) : <span className="block truncate text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{sub}</span>}
                  </span>
                </label>
                {!bulk && checked ? (
                  <button
                    type="button"
                    onClick={() => patch({ primary: cleaner.id })}
                    aria-label={isPrimary ? `${name} is the primary cleaner` : `Make ${name} primary`}
                    aria-pressed={isPrimary}
                    className={cn(
                      "inline-flex min-h-7 shrink-0 items-center gap-1 rounded-[var(--e-radius-pill)] border px-2 text-[0.6875rem] font-[600] max-sm:min-h-11 max-sm:px-3",
                      isPrimary
                        ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                        : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))] hover:text-[hsl(var(--e-foreground))]",
                    )}
                  >
                    <Star aria-hidden className="h-3 w-3" fill={isPrimary ? "currentColor" : "none"} />
                    {isPrimary ? "Primary" : "Set primary"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {warned.length > 0 || refusal ? (
          <ENote tone="attention" role="alert">
            <p className="font-[600]">Assign anyway?</p>
            {refusal ? <p>{refusal}</p> : warned.map((row) => <p key={row.id}>{row.name}: {row.lines.join("; ")}</p>)}
            <p className="mt-1">Assigning anyway is recorded in the activity log.</p>
          </ENote>
        ) : (
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            {bulk ? (jobCount === 1 ? "Assigns this cleaner to the selected job." : `Assigns this cleaner to the ${jobCount} selected jobs.`) : "Clashes show before you save. Choosing someone on leave asks “Assign anyway?” here."}
          </p>
        )}
        {failure ? <ENote tone="problem" role="alert">Not assigned: {failure}</ENote> : null}
      </fieldset>
    </EActionDialog>
  );
}
