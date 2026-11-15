"use client";

/**
 * The two fixes for a job with no rate, offered in place on its preview row:
 *   - Set a rate: the property's client rate for that job type, through the
 *     existing rates endpoint (PUT /api/admin/property-client-rates);
 *   - Give the job a fixed price: the job's own fixed client price, through
 *     the existing job update (PATCH /api/admin/jobs/[id], guarded by the
 *     job's last update time so it cannot overwrite a newer edit).
 * After either saves, the preview is read again; nothing is assumed in the
 * meantime. The amount field stays filled after a refusal, frozen while saving.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import type { PreviewJob } from "@/lib/billing/client-invoice-generate-preview-types";
import { jobLabel, jobTypeText } from "./new-invoice-format";

type FixKind = "rate" | "fixed";

type FixState = { status: "idle" } | { status: "saving" } | { status: "error"; message: string };

function readAmount(raw: string): number | null {
  const value = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

async function saveFix(kind: FixKind, job: PreviewJob, amount: number): Promise<string | null> {
  const response =
    kind === "rate"
      ? await fetch("/api/admin/property-client-rates", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ propertyId: job.propertyId, jobType: job.jobType, baseCharge: amount }),
        })
      : await fetch(`/api/admin/jobs/${encodeURIComponent(job.jobId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fixedPrice: amount, expectedUpdatedAt: job.updatedAt }),
        });
  if (response.ok) return null;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (response.status === 403) return "Your access does not allow this change. Ask someone who manages rates or jobs.";
  return body?.error ?? "It was not saved.";
}

export function RateFixLinks({ job, disabled, onSaved }: { job: PreviewJob; disabled: boolean; onSaved: () => void }) {
  const [open, setOpen] = React.useState<FixKind | null>(null);
  const [amount, setAmount] = React.useState("");
  const [state, setState] = React.useState<FixState>({ status: "idle" });
  const inputId = React.useId();
  const saving = state.status === "saving";
  const value = readAmount(amount);

  async function submit() {
    if (!open || value === null) return;
    setState({ status: "saving" });
    try {
      const refusal = await saveFix(open, job, value);
      if (refusal) {
        setState({ status: "error", message: refusal });
        return;
      }
      setState({ status: "idle" });
      setOpen(null);
      setAmount("");
      onSaved();
    } catch {
      setState({ status: "error", message: "No answer from the server. It may not have been saved; the preview shows what is stored." });
    }
  }

  const label = open === "rate" ? `Client rate for ${jobTypeText(job.jobType).toLowerCase()} at ${job.propertyName}, AUD ex GST` : `Fixed client price for ${jobLabel(job)}, AUD ex GST`;

  return (
    <span className="inline">
      {" · "}
      <button type="button" disabled={disabled || saving} aria-expanded={open === "rate"} onClick={() => { setOpen(open === "rate" ? null : "rate"); setState({ status: "idle" }); }} className="min-h-8 underline underline-offset-2 disabled:opacity-60 max-sm:min-h-11">
        Set a rate
      </button>
      {" · "}
      <button type="button" disabled={disabled || saving} aria-expanded={open === "fixed"} onClick={() => { setOpen(open === "fixed" ? null : "fixed"); setState({ status: "idle" }); }} className="min-h-8 underline underline-offset-2 disabled:opacity-60 max-sm:min-h-11">
        Give {jobLabel(job)} a fixed price
      </button>
      {open ? (
        <span className="mt-2 block rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2.5">
          <label htmlFor={inputId} className="block text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">{label}</label>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <input
              id={inputId}
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              disabled={saving}
              onChange={(event) => setAmount(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submit(); } }}
              className="h-9 w-32 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2 text-[0.875rem] max-sm:h-11 max-sm:w-full max-sm:text-[16px]"
            />
            <EButton type="button" size="sm" disabled={saving || value === null} onClick={() => void submit()}>
              {saving ? "Saving…" : open === "rate" ? "Save rate" : "Save price"}
            </EButton>
            <EButton type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setOpen(null); setState({ status: "idle" }); }}>
              Cancel
            </EButton>
          </span>
          {open === "rate" ? (
            <span className="mt-1 block text-[0.71875rem] text-[hsl(var(--e-muted-foreground))]">Applies to every {jobTypeText(job.jobType).toLowerCase()} at this property from now on, as in Billing rates.</span>
          ) : null}
          {state.status === "error" ? <span role="alert" className="mt-1 block text-[0.75rem] text-[hsl(var(--e-danger))]">It was not saved: {state.message}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
