"use client";

// Quick QA score queue — submitted jobs that never got a real inspection, each
// with a suggested score read off the cleaner's own submission. The admin
// reviews, adjusts anything they disagree with, and bulk-approves the rest.
//
// Jobs WITH a real inspection never appear here: that score stands and the job
// is completed on its authority (lib/qa/authority.ts).

import * as React from "react";
import { useRouter } from "next/navigation";
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

export function QuickScoreQueue() {
  const router = useRouter();
  const [jobs, setJobs] = React.useState<AwaitingJob[]>([]);
  const [threshold, setThreshold] = React.useState(80);
  const [autoScore, setAutoScore] = React.useState<{ enabled: boolean; afterHours: number } | null>(null);
  const [scores, setScores] = React.useState<Record<string, number>>({});
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/qa/awaiting", { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      const rows: AwaitingJob[] = body.jobs ?? [];
      setJobs(rows);
      setThreshold(body.threshold ?? 80);
      setAutoScore(body.autoScore ?? null);
      // Pre-fill every row with its suggestion — the admin only touches the
      // ones they disagree with, which is the whole point of the queue.
      setScores(Object.fromEntries(rows.map((r) => [r.jobId, r.suggestion.score])));
      setSelected(new Set(rows.map((r) => r.jobId)));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

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
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Bulk score failed",
          description: body.error ?? "Could not apply scores.",
          variant: "destructive",
        });
        return;
      }
      const skipped = Array.isArray(body.skipped) ? body.skipped.filter(Boolean).length : 0;
      toast({
        title: `${body.applied} job${body.applied === 1 ? "" : "s"} scored`,
        description: `${body.passed} marked completed.${
          skipped > 0 ? ` ${skipped} skipped (already inspected or not scoreable).` : ""
        }`,
      });
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = selected.size;

  return (
    <ECard className="min-w-0">
      <ECardHeader className="flex-row items-start justify-between gap-3 pb-2">
        <div className="min-w-0">
          <ECardTitle className="flex flex-wrap items-center gap-2 text-[0.95rem]">
            <CheckCircle2 className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Awaiting QA — quick score
            {jobs.length > 0 ? <EBadge tone="warning" soft>{jobs.length}</EBadge> : null}
          </ECardTitle>
          <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Submitted jobs with no QA inspection. Scores are suggested from the submission — adjust
            any you disagree with, then approve.
            {autoScore?.enabled
              ? ` Anything left is auto-scored after ${autoScore.afterHours}h.`
              : " Auto-scoring is off."}
          </p>
        </div>
        <EButton size="sm" variant="gold" onClick={() => void approveSelected()} disabled={busy || selectedCount === 0}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Approve {selectedCount > 0 ? selectedCount : ""}
        </EButton>
      </ECardHeader>
      <ECardBody className="pt-0">
        {loading ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Nothing waiting — every submitted job has a QA outcome.
          </p>
        ) : (
          <ul className="divide-y divide-[hsl(var(--e-border))]">
            {jobs.map((job) => {
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
                      <Link
                        href={`/v2/admin/jobs/${job.jobId}?tab=forms`}
                        className="text-[0.875rem] font-[600] text-[hsl(var(--e-accent-portal))] hover:underline"
                      >
                        {job.jobNumber}
                      </Link>
                      <span className="text-[0.8125rem]">{job.propertyName}</span>
                      {job.suburb ? (
                        <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{job.suburb}</span>
                      ) : null}
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
                    <p
                      className={
                        job.suggestion.clean
                          ? "mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]"
                          : "mt-1 text-[0.75rem] text-[hsl(var(--e-warning))]"
                      }
                    >
                      <Info className="mr-1 inline h-3 w-3" />
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
                      onChange={(e) =>
                        setScores((prev) => ({
                          ...prev,
                          [job.jobId]: Math.max(0, Math.min(100, Number(e.target.value))),
                        }))
                      }
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
