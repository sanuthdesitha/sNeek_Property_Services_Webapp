"use client";

// Quick QA score queue — submitted jobs that never got a real inspection, each
// with a suggested score read off the cleaner's own submission. The admin
// reviews, adjusts anything they disagree with, and bulk-approves the rest.
//
// Jobs WITH a real inspection never appear here: that score stands and the job
// is completed on its authority (lib/qa/authority.ts).
//
// The list is the whole queue for the hub's property/search filters (up to the
// API's 200 oldest), so sorting it here re-orders a complete set, not a page.
// A newer read cancels an older one; score edits and the selection survive a
// re-sort but reset when the filters change.

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Info, Loader2 } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EInput } from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";

type Factor = { code: string; label: string; penalty: number; count: number };
type AwaitingJob = {
  jobId: string;
  jobNumber: string;
  propertyName: string;
  suburb: string;
  jobTypeLabel: string;
  scheduledDate: string;
  submittedAt: string | null;
  cleanerNames: string[];
  hoursSinceSubmission: number | null;
  suggestion: { score: number; factors: Factor[]; summary: string; clean: boolean };
};
type AwaitingPayload = {
  jobs: AwaitingJob[];
  limit?: number;
  threshold?: number;
  autoScore?: { enabled: boolean; afterHours: number } | null;
};

const SORTS = [
  { key: "scheduled", label: "Oldest clean first" },
  { key: "waiting", label: "Waiting longest" },
  { key: "property", label: "Property" },
  { key: "score-asc", label: "Lowest suggested score" },
  { key: "score-desc", label: "Highest suggested score" },
] as const;
type QueueSort = (typeof SORTS)[number]["key"];

function sortJobs(jobs: AwaitingJob[], sort: QueueSort): AwaitingJob[] {
  const copy = [...jobs];
  switch (sort) {
    case "property":
      return copy.sort((a, b) => a.propertyName.localeCompare(b.propertyName) || a.jobNumber.localeCompare(b.jobNumber));
    case "score-asc":
      return copy.sort((a, b) => a.suggestion.score - b.suggestion.score);
    case "score-desc":
      return copy.sort((a, b) => b.suggestion.score - a.suggestion.score);
    case "waiting":
      return copy.sort((a, b) => (b.hoursSinceSubmission ?? -1) - (a.hoursSinceSubmission ?? -1));
    default:
      // The API's own order: scheduled date, oldest first.
      return copy;
  }
}

function isPayload(body: unknown): body is AwaitingPayload {
  return Boolean(body) && typeof body === "object" && Array.isArray((body as AwaitingPayload).jobs);
}

export function QuickScoreQueue({
  filterQuery = "",
  totalCandidates = null,
  onScored,
}: {
  /** Hub property / search filters as a query string. */
  filterQuery?: string;
  /** Real count of candidates for these filters, when known (the list stops at the API limit). */
  totalCandidates?: number | null;
  onScored?: () => void;
}) {
  const [jobs, setJobs] = React.useState<AwaitingJob[]>([]);
  const [limit, setLimit] = React.useState<number | null>(null);
  const [threshold, setThreshold] = React.useState(80);
  const [autoScore, setAutoScore] = React.useState<{ enabled: boolean; afterHours: number } | null>(null);
  const [scores, setScores] = React.useState<Record<string, number>>({});
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [sort, setSort] = React.useState<QueueSort>("scheduled");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [token, setToken] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/admin/qa/awaiting${filterQuery ? `?${filterQuery}` : ""}`, { cache: "no-store", signal: controller.signal });
        const body: unknown = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok || !isPayload(body)) {
          setError("The quick-score queue could not be loaded.");
          return;
        }
        setError(null);
        setJobs(body.jobs);
        setLimit(typeof body.limit === "number" ? body.limit : null);
        setThreshold(body.threshold ?? 80);
        setAutoScore(body.autoScore ?? null);
        // Pre-fill every row with its suggestion — the admin only touches the
        // ones they disagree with, which is the whole point of the queue.
        setScores(Object.fromEntries(body.jobs.map((row) => [row.jobId, row.suggestion.score])));
        setSelected(new Set(body.jobs.map((row) => row.jobId)));
      } catch {
        if (!controller.signal.aborted) setError("The quick-score queue could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [filterQuery, token]);

  const sorted = React.useMemo(() => sortJobs(jobs, sort), [jobs, sort]);

  function toggle(jobId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  async function approveSelected() {
    const items = jobs
      .filter((job) => selected.has(job.jobId))
      .map((job) => ({ jobId: job.jobId, score: scores[job.jobId] ?? job.suggestion.score }));
    if (items.length === 0) {
      toast({ title: "Nothing selected", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/qa/bulk-quick-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; applied?: number; passed?: number; skipped?: unknown[] };
      if (!res.ok) {
        toast({ title: "Bulk score failed", description: body.error ?? "Could not apply scores.", variant: "destructive" });
        return;
      }
      const skipped = Array.isArray(body.skipped) ? body.skipped.filter(Boolean).length : 0;
      toast({
        title: `${body.applied} job${body.applied === 1 ? "" : "s"} scored`,
        description: `${body.passed} marked completed.${skipped > 0 ? ` ${skipped} skipped (already inspected or not scoreable).` : ""}`,
      });
      setToken((value) => value + 1);
      onScored?.();
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = selected.size;
  const capped = limit !== null && totalCandidates !== null && totalCandidates > jobs.length;

  return (
    <ECard className="min-w-0">
      <ECardHeader className="flex-row flex-wrap items-start justify-between gap-3 pb-2">
        <div className="min-w-0">
          <ECardTitle className="flex flex-wrap items-center gap-2 text-[0.95rem]">
            <CheckCircle2 aria-hidden className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Awaiting QA — quick score
            {jobs.length > 0 ? <EBadge tone="warning" soft>{jobs.length}</EBadge> : null}
          </ECardTitle>
          <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Submitted jobs with no QA inspection. Scores are suggested from the submission — adjust any you disagree with, then approve.
            {autoScore?.enabled ? ` Anything left is auto-scored after ${autoScore.afterHours}h.` : " Auto-scoring is off."}
          </p>
          {capped ? (
            <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-warning))]">{`Showing the ${jobs.length} oldest of ${totalCandidates}. Approve these to see the rest.`}</p>
          ) : null}
        </div>
        <EButton size="sm" variant="gold" onClick={() => void approveSelected()} disabled={busy || selectedCount === 0}>
          {busy ? <Loader2 aria-hidden className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Approve {selectedCount > 0 ? selectedCount : ""}
        </EButton>
      </ECardHeader>
      <ECardBody className="pt-0">
        {jobs.length > 0 ? (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.75rem]">
            <EButton size="sm" variant="outline" disabled={busy} onClick={() => setSelected(new Set(jobs.map((job) => job.jobId)))}>
              Select all
            </EButton>
            <EButton size="sm" variant="outline" disabled={busy || selectedCount === 0} onClick={() => setSelected(new Set())}>
              Clear
            </EButton>
            <label className="ml-auto inline-flex items-center gap-1.5 text-[hsl(var(--e-text-secondary))]">
              Sort
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as QueueSort)}
                className="h-8 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[0.75rem]"
              >
                {SORTS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
            {jobs.length > 0 ? "Showing the last loaded queue. " : ""}
            {error}{" "}
            <button type="button" className="underline" onClick={() => setToken((value) => value + 1)}>
              Try again
            </button>
          </p>
        ) : null}
        {loading && jobs.length === 0 ? (
          <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : !error && jobs.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Nothing waiting — every submitted job has a QA outcome.</p>
        ) : (
          <ul className="divide-y divide-[hsl(var(--e-border))]" aria-busy={loading || undefined}>
            {sorted.map((job) => {
              const score = scores[job.jobId] ?? job.suggestion.score;
              const wouldPass = score >= threshold;
              return (
                <li key={job.jobId} className="flex flex-wrap items-start gap-3 py-3">
                  <input
                    type="checkbox"
                    className="mt-1.5 h-4 w-4 shrink-0"
                    checked={selected.has(job.jobId)}
                    onChange={() => toggle(job.jobId)}
                    disabled={busy}
                    aria-label={`Select job ${job.jobNumber}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/v2/admin/jobs/${job.jobId}?tab=forms`} className="text-[0.875rem] font-[600] text-[hsl(var(--e-accent-portal))] hover:underline">
                        {job.jobNumber}
                      </Link>
                      <span className="text-[0.8125rem]">{job.propertyName}</span>
                      {job.suburb ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{job.suburb}</span> : null}
                      {job.hoursSinceSubmission != null ? (
                        <EBadge tone={job.hoursSinceSubmission >= 24 ? "warning" : "info"} soft>
                          {job.hoursSinceSubmission}h ago
                        </EBadge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {job.jobTypeLabel}
                      {job.cleanerNames.length ? ` · ${job.cleanerNames.join(", ")}` : ""}
                    </p>
                    <p className={job.suggestion.clean ? "mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]" : "mt-1 text-[0.75rem] text-[hsl(var(--e-warning))]"}>
                      <Info aria-hidden className="mr-1 inline h-3 w-3" />
                      {job.suggestion.summary}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <EInput
                      type="number"
                      min={0}
                      max={100}
                      value={score}
                      disabled={busy}
                      className="h-8 w-20"
                      onChange={(e) => setScores((prev) => ({ ...prev, [job.jobId]: Math.max(0, Math.min(100, Number(e.target.value))) }))}
                      aria-label={`Score for ${job.jobNumber}`}
                    />
                    <EBadge tone={wouldPass ? "success" : "danger"} soft>
                      {wouldPass ? "Completes" : "Stays in QA"}
                    </EBadge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ECardBody>
    </ECard>
  );
}
