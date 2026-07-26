"use client";

/**
 * Rich "Reset job" dialog (Estate modal).
 *
 * Default = the safe reset the ops team actually wants day to day: put the job
 * back to Assigned and clear the start/progress markers so the cleaner gets a
 * clean start verification, while every time record, assignee, submitted form,
 * photo and pay adjustment stays exactly as it is.
 *
 * Everything destructive is opt-in, individually explained, visually marked, and
 * summarised before the admin confirms. The preview is computed with the SAME
 * pure planner the server runs (lib/jobs/job-reset.ts), so what's promised here
 * is what happens.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, RotateCcw, ShieldCheck } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect } from "@/components/v2/admin/estate-kit";
import {
  DEFAULT_JOB_RESET_OPTIONS,
  JOB_RESET_TARGET_STATUSES,
  planJobReset,
  type JobResetContext,
  type JobResetOptions,
  type JobResetTargetStatus,
} from "@/lib/jobs/job-reset";

const STATUS_LABEL: Record<JobResetTargetStatus, string> = {
  ASSIGNED: "Assigned — keep the crew, they start again",
  OFFERED: "Offered — cleaners must accept again",
  UNASSIGNED: "Unassigned — back in the dispatch pool",
};

function OptionRow({
  checked,
  onChange,
  disabled,
  title,
  consequence,
  destructive,
  note,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title: string;
  consequence: string;
  destructive?: boolean;
  note?: string;
}) {
  return (
    <label
      className={[
        "flex cursor-pointer items-start gap-3 rounded-[var(--e-radius)] border p-3",
        disabled ? "cursor-not-allowed opacity-55" : "",
        destructive
          ? "border-[hsl(var(--e-danger)/0.4)] bg-[hsl(var(--e-danger)/0.04)]"
          : "border-[hsl(var(--e-border))]",
      ].join(" ")}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-[hsl(var(--e-gold))]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[0.875rem] font-[550]">
          {destructive ? <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--e-danger))]" /> : null}
          {title}
        </span>
        <span className="mt-0.5 block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{consequence}</span>
        {note ? (
          <span className="mt-0.5 block text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{note}</span>
        ) : null}
      </span>
    </label>
  );
}

export function JobResetDialog({
  open,
  jobId,
  onClose,
  onDone,
}: {
  open: boolean;
  jobId: string | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [context, setContext] = useState<JobResetContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<JobResetOptions>(DEFAULT_JOB_RESET_OPTIONS);
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [extraConfirmed, setExtraConfirmed] = useState(false);

  useEffect(() => {
    if (!open || !jobId) return;
    setOptions(DEFAULT_JOB_RESET_OPTIONS);
    setPin("");
    setPassword("");
    setExtraConfirmed(false);
    setError(null);
    setContext(null);
    setLoading(true);
    fetch(`/api/admin/jobs/${jobId}/reset`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Could not load the job's reset details.");
        setContext(body.context as JobResetContext);
      })
      .catch((err: any) => setError(err?.message ?? "Could not load the job's reset details."))
      .finally(() => setLoading(false));
  }, [open, jobId]);

  const plan = useMemo(
    () => (context ? planJobReset(options, context) : null),
    [context, options]
  );

  function set<K extends keyof JobResetOptions>(key: K, value: JobResetOptions[K]) {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }

  const securityOk = !plan?.destructive || Boolean(pin.trim() || password.trim());
  const confirmOk = !plan?.requiresExtraConfirm || extraConfirmed;
  const canConfirm = Boolean(plan?.allowed) && securityOk && confirmOk && !busy && !loading;

  async function run() {
    if (!jobId || !plan) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          options,
          confirmProtected: extraConfirmed || undefined,
          security: plan.destructive ? { pin: pin.trim() || undefined, password: password.trim() || undefined } : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not reset the job.");
      onClose();
      await onDone();
    } catch (err: any) {
      setError(err?.message ?? "Could not reset the job.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EModal open={open} onClose={onClose} size="wide" eyebrow="Reset job" title="What should this reset touch?">
      <div className="space-y-4">
        {loading ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading the job's records…</p>
        ) : null}

        {error ? (
          <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-danger))] p-3 text-[0.8125rem] text-[hsl(var(--e-danger))]">
            {error}
          </p>
        ) : null}

        {context ? (
          <>
            <EField
              label="Reset the status to"
              hint="The job's start/progress markers are always cleared so the assigned cleaner gets a fresh start verification."
            >
              <ESelect
                value={options.targetStatus}
                onChange={(e) => set("targetStatus", e.target.value as JobResetTargetStatus)}
              >
                {JOB_RESET_TARGET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </ESelect>
            </EField>

            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border-gold)/0.5)] bg-[hsl(var(--e-gold-soft))] p-3">
              <p className="flex items-center gap-1.5 text-[0.875rem] font-[550]">
                <ShieldCheck className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" /> Kept by default
              </p>
              <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                Everyone&apos;s clock records and hours, the assigned cleaners, the submitted form, checklist and
                photos, and all pay / adjustments stay untouched unless you tick an option below.
              </p>
            </div>

            <div className="space-y-2">
              <p className="e-eyebrow">Also clear (optional)</p>
              <OptionRow
                checked={options.clearTimeLogs}
                onChange={(v) => set("clearTimeLogs", v)}
                disabled={(context.timeLogCount ?? 0) === 0}
                destructive
                title="Clear time logs"
                consequence={`Deletes every clock record on this job — logged hours and the pay derived from them are lost.`}
                note={`${context.timeLogCount ?? 0} clock record(s) on this job.`}
              />
              <OptionRow
                checked={options.clearFormData}
                onChange={(v) => set("clearFormData", v)}
                disabled={(context.submissionCount ?? 0) === 0}
                destructive
                title="Clear submitted form, checklist & photos"
                consequence="The cleaner has to fill the checklist and re-upload photos; stock recorded as used is put back."
                note={`${context.submissionCount ?? 0} submission(s), ${context.photoCount ?? 0} photo(s).`}
              />
              <OptionRow
                checked={options.unassignCleaners}
                onChange={(v) => set("unassignCleaners", v)}
                disabled={(context.assigneeCount ?? 0) === 0}
                destructive
                title="Unassign all cleaners"
                consequence="Removes everyone from the job — it needs re-dispatching before anyone can start."
                note={`${context.assigneeCount ?? 0} cleaner(s) currently assigned.`}
              />
              <OptionRow
                checked={options.clearQa}
                onChange={(v) => set("clearQa", v)}
                disabled={(context.qaReviewCount ?? 0) === 0}
                destructive
                title="Clear QA review / outcome"
                consequence="Deletes the QA reviews on this job and reopens the QA assignment for a fresh inspection."
                note={
                  (context.qaReviewCount ?? 0) === 0
                    ? "No QA data on this job."
                    : `${context.qaReviewCount} QA review(s) recorded.`
                }
              />
              <OptionRow
                checked={options.resetLaundry}
                onChange={(v) => set("resetLaundry", v)}
                disabled={context.hasLaundryTask !== true}
                destructive
                title="Reset laundry task"
                consequence="Puts the laundry task back to Pending and clears pickup/drop-off timestamps and confirmations."
                note={context.hasLaundryTask ? undefined : "No laundry task on this job."}
              />
            </div>

            {/* ── What will happen ──────────────────────────────────────────── */}
            {plan ? (
              <div
                className={[
                  "rounded-[var(--e-radius)] border p-3",
                  plan.allowed
                    ? "border-[hsl(var(--e-border))]"
                    : "border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger)/0.05)]",
                ].join(" ")}
              >
                <p className="e-eyebrow">On confirm</p>
                {plan.allowed ? (
                  <ul className="mt-1.5 space-y-1">
                    {plan.mutations.map((m) => (
                      <li
                        key={m.key}
                        className={[
                          "text-[0.8125rem]",
                          m.destructive
                            ? "text-[hsl(var(--e-danger))]"
                            : "text-[hsl(var(--e-text-secondary))]",
                        ].join(" ")}
                      >
                        • {m.label}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-[0.8125rem] text-[hsl(var(--e-danger))]">{plan.blockedReason}</p>
                )}
              </div>
            ) : null}

            {plan?.allowed && plan.requiresExtraConfirm ? (
              <label className="flex cursor-pointer items-start gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.4)] p-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[hsl(var(--e-danger))]"
                  checked={extraConfirmed}
                  onChange={(e) => setExtraConfirmed(e.target.checked)}
                />
                <span className="text-[0.8125rem]">
                  This job is completed or its pay is already committed. I understand and want to reset it anyway.
                </span>
              </label>
            ) : null}

            {plan?.allowed && plan.destructive ? (
              <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Clearing records is security-verified. Enter your PIN or password.
                </p>
                <EField label="PIN">
                  <EInput value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" type="password" />
                </EField>
                <EField label="Password">
                  <EInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="off"
                    type="password"
                  />
                </EField>
              </div>
            ) : null}
          </>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
          <EButton variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </EButton>
          <EButton variant={plan?.destructive ? "danger" : "gold"} onClick={run} disabled={!canConfirm}>
            <RotateCcw className="h-4 w-4" />
            {busy ? "Resetting…" : plan?.destructive ? "Reset & clear selected" : "Reset status only"}
          </EButton>
        </div>
      </div>
    </EModal>
  );
}
