"use client";

/**
 * Stock → Stock counts → "Counts from job forms" (lazy disclosure). Each Stock
 * count answer on a job form, what happened to it (waiting for the clean's
 * approval, applied with the previous on-hand, not applied because a newer
 * stock movement exists, needs review, reviewed, replaced by a newer
 * submission, reversed when the job was reset) and the reason. A count that needs review can be marked
 * reviewed with a note; nothing here changes on-hand.
 */
import * as React from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { EButton } from "@/components/v2/ui/primitives";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { EField, EModal, ETextarea } from "@/components/v2/admin/estate-kit";
import type { FormCountFilter, FormCountList, FormCountRow } from "@/lib/inventory/stock-count-observation-list";

const STATUS_LABEL: Record<FormCountRow["status"], string> = {
  PENDING: "Waiting for approval",
  APPLIED: "Applied",
  SKIPPED_NEWER: "Not applied · newer record",
  NEEDS_REVIEW: "Needs review",
  REVIEWED: "Reviewed",
  SUPERSEDED: "Replaced by a newer submission",
  REVERSED: "Reversed when the job was reset",
};
const FILTER_LABEL: Record<FormCountFilter, string> = { review: "Needs review", pending: "Waiting for approval", all: "All" };

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: FormCountList };

function day(iso: string, timeZone: string) {
  return formatInTimeZone(new Date(iso), timeZone, "d MMM HH:mm");
}

function CountsTable({ filter, timeZone }: { filter: FormCountFilter; timeZone: string }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [revision, setRevision] = React.useState(0);
  const [reviewing, setReviewing] = React.useState<FormCountRow | null>(null);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetch(`/api/admin/inventory/stock-counts/form-observations?filter=${filter}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (FormCountList & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.rows) throw new Error(body?.error ?? "Could not load counts from job forms.");
        setLoad({ status: "ready", value: body });
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: failure instanceof Error ? failure.message : "Could not load counts from job forms." });
      });
    return () => controller.abort();
  }, [filter, revision]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reviewing) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/inventory/stock-counts/form-observations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: reviewing.id, note }) });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Not saved.");
      setReviewing(null);
      setNote("");
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Not saved.");
    } finally {
      setSaving(false);
    }
  }

  if (load.status === "loading") return <p role="status" className="text-[0.8125rem]">Loading…</p>;
  if (load.status === "error") return <div role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{load.message} <EButton size="sm" variant="ghost" onClick={() => setRevision((value) => value + 1)}>Retry</EButton></div>;
  const rows = load.value.rows;
  return (
    <>
      {rows.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Nothing here.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-[0.8125rem]">
            <thead className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">
              <tr><th className="py-1.5 pr-3">Item</th><th className="pr-3">Property</th><th className="pr-3 text-right">Counted</th><th className="pr-3">Job</th><th className="pr-3">State</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--e-border))]">
              {rows.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="py-2 pr-3"><span className="font-[550]">{row.itemName}</span><p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.label} · {day(row.observedAt, timeZone)}</p></td>
                  <td className="py-2 pr-3">{row.propertyName}</td>
                  <td className="e-tnum py-2 pr-3 text-right">{row.count}{row.unit ? ` ${row.unit}` : ""}{row.previousOnHand !== null ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">was {row.previousOnHand}</p> : null}</td>
                  <td className="py-2 pr-3">{row.job ? <Link className="text-[hsl(var(--e-primary))] hover:underline" href={`/v2/admin/jobs/${row.job.id}`}>{row.job.jobNumber ?? "Job"}</Link> : "–"}</td>
                  <td className="py-2 pr-3"><span className="font-[550]">{STATUS_LABEL[row.status]}</span>{row.reason ? <p className="max-w-[22rem] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.reason}</p> : null}</td>
                  <td className="py-2 text-right">{row.status === "NEEDS_REVIEW" ? <EButton size="sm" variant="outline" onClick={() => { setReviewing(row); setNote(""); setError(null); }}>Mark reviewed</EButton> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <EModal open={reviewing !== null} onClose={() => (saving ? undefined : setReviewing(null))} eyebrow="Counts from job forms" title="Mark reviewed">
        <form onSubmit={submit}>
          <fieldset disabled={saving} className="space-y-3">
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">On-hand is not changed. If the property should stock this item, add it and record a count.</p>
            <EField label="What you did"><ETextarea required maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></EField>
            {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
            <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
              <EButton type="button" size="sm" variant="outline" onClick={() => setReviewing(null)}>Cancel</EButton>
              <EButton type="submit" size="sm" disabled={!note.trim()}>{saving ? "Saving…" : "Mark reviewed"}</EButton>
            </div>
          </fieldset>
        </form>
      </EModal>
    </>
  );
}

export function FormCountObservations({ timeZone }: { timeZone: string }) {
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<FormCountFilter>("review");
  return (
    <section aria-label="Counts from job forms" className="rounded-[12px] border border-[hsl(var(--e-border))] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[0.9375rem] font-[600]">Counts from job forms</h2>
        <EButton size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "Hide" : "Show"}</EButton>
      </div>
      <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">A Stock count answer sets on-hand when the clean is approved, unless a newer stock movement exists. Answers that do not match the property&apos;s stock wait here for review.</p>
      {open ? (
        <div className="mt-3 space-y-3">
          <EFilterChips label="Count states" chips={(Object.keys(FILTER_LABEL) as FormCountFilter[]).map((key) => ({ key, label: FILTER_LABEL[key], count: null }))} active={filter} onChange={(key) => setFilter(key as FormCountFilter)} />
          <CountsTable key={filter} filter={filter} timeZone={timeZone} />
        </div>
      ) : null}
    </section>
  );
}
