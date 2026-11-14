"use client";

/**
 * "Duplicate a job…": find an earlier job by number and copy what the board
 * lists (and nothing else). Read only until "Copy" fills the page.
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/admin/estate-kit";
import { JobDialog } from "@/components/v2/admin/jobs/job-dialog";
import { dayLabel, jobTypeLabel } from "@/lib/jobs/new-job/draft";
import type { NewJobDuplicateSource } from "@/lib/jobs/new-job/types";

export function DuplicateDialog({ open, onClose, onCopy }: { open: boolean; onClose: () => void; onCopy: (source: NewJobDuplicateSource) => void }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ status: "idle" | "loading" | "ready" | "error"; sources: NewJobDuplicateSource[] }>({ status: "idle", sources: [] });
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const text = query.trim();
    if (text.length < 2) {
      setState({ status: "idle", sources: [] });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({ status: "loading", sources: previous.sources }));
    const timer = setTimeout(() => {
      fetch(`/api/admin/jobs/new-job/duplicate?q=${encodeURIComponent(text)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as { sources?: NewJobDuplicateSource[] } | null;
          if (controller.signal.aborted) return;
          if (!response.ok || !body?.sources) return setState({ status: "error", sources: [] });
          setState({ status: "ready", sources: body.sources });
        })
        .catch(() => {
          if (!controller.signal.aborted) setState({ status: "error", sources: [] });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  const chosen = state.sources.find((source) => source.jobId === selected) ?? null;

  return (
    <JobDialog open={open} title="Duplicate a job" onClose={onClose}>
      <div className="space-y-3 text-[0.8125rem]">
        <label htmlFor="new-job-duplicate-search" className="block font-[550]">Job number</label>
        <EInput id="new-job-duplicate-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="J-1051" className="max-sm:text-[16px]" autoFocus />
        {state.status === "loading" ? <p className="text-[hsl(var(--e-text-secondary))]">Searching…</p> : null}
        {state.status === "error" ? <p role="alert" className="text-[hsl(var(--e-danger))]">Jobs could not be searched.</p> : null}
        {state.status === "ready" && state.sources.length === 0 ? <p className="text-[hsl(var(--e-text-secondary))]">No job matches.</p> : null}
        <div role="radiogroup" aria-label="Jobs to copy" className="space-y-1.5">
          {state.sources.map((source) => (
            <label key={source.jobId} className="flex min-h-[44px] cursor-pointer items-start gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2">
              <input type="radio" name="duplicate-source" checked={selected === source.jobId} onChange={() => setSelected(source.jobId)} className="mt-1" />
              <span>
                <span className="font-[600]">{source.jobNumber} · {source.propertyName}</span>
                <span className="block text-[hsl(var(--e-text-secondary))]">{jobTypeLabel(source.jobType)} · {dayLabel(source.dayKey)} · {source.cleaners.join(", ") || "nobody assigned"} · {source.status.replace(/_/g, " ").toLowerCase()}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="font-[600]">Copied</p>
            <ul className="list-disc pl-4 text-[hsl(var(--e-text-secondary))]">
              <li>Property, type, start, ready by, end, pay hours</li>
              <li>Special tasks, notice, notes, tags, reference files</li>
              <li>Fixed price and invoice note, if set</li>
            </ul>
          </div>
          <div>
            <p className="font-[600]">Not copied</p>
            <ul className="list-disc pl-4 text-[hsl(var(--e-text-secondary))]">
              <li>Date, cleaners, guest and booking details</li>
              <li>Status, evidence, form answers, laundry run, pay</li>
              <li>Early check-in and late checkout (they belong to a booking)</li>
            </ul>
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <EButton type="button" variant="ghost" onClick={onClose}>Cancel</EButton>
          <EButton type="button" disabled={!chosen} onClick={() => chosen && onCopy(chosen)}>{chosen ? `Copy from ${chosen.jobNumber}` : "Copy"}</EButton>
        </div>
      </div>
    </JobDialog>
  );
}
