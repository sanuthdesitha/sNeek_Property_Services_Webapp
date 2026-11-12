"use client";

/**
 * "Add finished jobs (N not billed)": pick the client's finished, unbilled
 * jobs (inside or outside the period), each with the charge the generator
 * would bill. A job with no rate is listed but cannot be chosen. The server
 * re-checks every job under the billing lock and refuses the whole request
 * with its reason; the choice is kept on a refusal so it can be retried.
 */
import { useMemo, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EModal } from "@/components/v2/admin/estate-kit";
import { fmtDay, money } from "../invoice-model";
import type { LineSuggestions } from "./use-line-suggestions";

export function AddJobsDialog({
  suggestions,
  busy,
  onAdd,
  onClose,
}: {
  suggestions: LineSuggestions;
  busy: boolean;
  /** Resolves true when the jobs were added. */
  onAdd: (jobIds: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const jobs = suggestions.jobs;
  const list = useMemo(() => (jobs.status === "ready" ? jobs.value.jobs : []), [jobs]);
  const chosenTotal = useMemo(
    // Display only: the sum of the charges shown; the server computes the invoice.
    () => list.filter((job) => chosen.has(job.id)).reduce((sum, job) => sum + Math.round((job.charge ?? 0) * 100), 0) / 100,
    [chosen, list],
  );

  function toggle(id: string, on: boolean) {
    setChosen((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function add() {
    if (await onAdd(Array.from(chosen))) onClose();
  }

  return (
    <EModal open onClose={() => !busy && onClose()} eyebrow="Invoice" title="Add finished jobs" wide>
      <div className="space-y-3">
        {jobs.status === "loading" ? <p role="status" className="text-[0.8125rem]">Loading unbilled jobs…</p> : null}
        {jobs.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{jobs.message}</p> : null}
        {jobs.status === "ready" && list.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">This client has no finished jobs that are not on an invoice.</p>
        ) : null}
        {list.length ? (
          <fieldset disabled={busy}>
            <legend className="mb-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              Finished jobs of this client on no live invoice. Each is added as one line, priced as the draft generator would.
              {jobs.status === "ready" && jobs.value.truncated ? ` Showing the newest ${list.length} of ${jobs.value.total}.` : ""}
            </legend>
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2">
              {list.map((job) => {
                const noRate = job.charge === null;
                return (
                  <li key={job.id}>
                    <label className={`flex min-h-11 flex-wrap items-center gap-x-2.5 rounded-[var(--e-radius-sm)] px-2 text-[0.8125rem] ${noRate ? "opacity-70" : "hover:bg-[hsl(var(--e-muted))]"}`}>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[hsl(var(--e-primary))]"
                        checked={chosen.has(job.id)}
                        disabled={noRate}
                        onChange={(event) => toggle(job.id, event.target.checked)}
                      />
                      <span className="font-mono text-[0.75rem]">{job.jobNumber ?? "Job"}</span>
                      <span className="min-w-0 flex-1 break-words">
                        {job.propertyName} · {job.jobType.replace(/_/g, " ").toLowerCase()} · {fmtDay(job.scheduledDay)}
                        {job.inPeriod === false ? <span className="text-[hsl(var(--e-warning))]"> · outside the period</span> : null}
                      </span>
                      <span className={noRate ? "text-[hsl(var(--e-warning))]" : "e-tnum"}>{noRate ? "No rate: set one first" : money(job.charge)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {chosen.size ? <span className="mr-auto text-[0.8125rem] e-tnum">{chosen.size} chosen · {money(chosenTotal)} before GST</span> : null}
          <EButton size="sm" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </EButton>
          <EButton size="sm" disabled={busy || chosen.size === 0} onClick={() => void add()}>
            {busy ? "Adding…" : `Add ${chosen.size || ""} job${chosen.size === 1 ? "" : "s"}`.replace("  ", " ")}
          </EButton>
        </div>
      </div>
    </EModal>
  );
}
