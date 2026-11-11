"use client";

/**
 * The Jobs peek panel (`?open=<jobId>`): status, "Open full job", the job's
 * title line, Summary | People | Money | Activity loaded on demand, suggested
 * cleaners for an unassigned job, and links into the job's existing flows.
 * Rescheduling, client messages and skipping (the app's cancellation) stay on
 * the job detail page; these buttons open the tab that owns each flow.
 */
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EButton } from "@/components/v2/ui/primitives";
import { jobDetailTabHref } from "@/lib/jobs/detail-tabs";
import { JobStatusPill, jobTypeLabel, scheduledLabel, timeWindowLabel } from "./job-row";
import type { JobListRow } from "./jobs-query";
import { PeekActivity, PeekMoney, PeekPeople, PeekSuggestions, PeekSummaryList, SectionState } from "./peek-sections";
import { PEEK_TABS, useJobPeek } from "./use-job-peek";

type PeekPanelProps = {
  jobId: string | null;
  /** The list row, shown while the Summary loads. */
  row: JobListRow | null;
  readOnly: boolean;
  onClose: () => void;
  /** After an assignment from the panel: refresh the list too. */
  onChanged: () => void;
};

export function JobPeekPanel({ jobId, row, readOnly, onClose, onChanged }: PeekPanelProps) {
  const peek = useJobPeek(jobId);
  const summary = peek.summary.status === "success" && peek.summary.data?.id === jobId ? peek.summary.data : null;
  const title = summary?.property.name ?? row?.property?.name ?? "Job";
  const status = summary?.status ?? row?.status ?? null;
  const facts = summary ?? row;
  const subtitle = facts
    ? [
        scheduledLabel(facts.scheduledDate, "EEE d MMM"),
        timeWindowLabel({ startTime: facts.startTime ?? null, endTime: facts.endTime ?? null, dueTime: facts.dueTime ?? null }),
        jobTypeLabel(facts.jobType ?? null),
        facts.jobNumber ? String(facts.jobNumber) : null,
      ].filter(Boolean).join(" · ")
    : null;

  if (!jobId) return null;
  return (
    <ESidePanel
      // Re-keyed per job: focus moves to the new job's title and Escape returns
      // to the row that opened this job.
      key={jobId}
      open
      label="Job preview"
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      toolbar={
        <>
          {status ? <JobStatusPill status={status} /> : null}
          <EButton asChild size="sm" variant="outline"><Link href={`/v2/admin/jobs/${jobId}`}>Open full job</Link></EButton>
        </>
      }
    >
      <div role="group" aria-label="Preview sections" className="flex gap-1 border-b border-[hsl(var(--e-border))]">
        {PEEK_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={peek.tab === tab.id}
            onClick={() => peek.setTab(tab.id)}
            className={cn(
              "border-b-2 px-3 py-2 text-[0.8125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
              peek.tab === tab.id ? "border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-primary))]" : "border-transparent text-[hsl(var(--e-muted-foreground))]",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!summary ? <SectionState value={peek.summary} label="this job" onRetry={peek.reloadSummary} /> : (
        <>
          {peek.tab === "summary" ? <PeekSummaryList summary={summary} /> : null}
          {peek.tab === "people" ? <PeekPeople summary={summary} /> : null}
          {peek.tab === "money" ? <PeekMoney summary={summary} value={peek.money} onRetry={() => peek.setTab("money")} /> : null}
          {peek.tab === "activity" ? <PeekActivity value={peek.activity} onRetry={() => peek.setTab("activity")} /> : null}
          {(peek.tab === "summary" || peek.tab === "people") && summary.assignments.length === 0 ? (
            <>
              <div className="h-px bg-[hsl(var(--e-border))]" />
              <PeekSuggestions jobId={summary.id} value={peek.suggestions} readOnly={readOnly}
                onAssigned={() => { peek.reloadSummary(); onChanged(); }} />
            </>
          ) : null}
        </>
      )}

      <div className="h-px bg-[hsl(var(--e-border))]" />
      <div className="flex flex-wrap gap-2">
        <EButton asChild size="sm" variant="outline"><Link href={jobDetailTabHref(jobId, "schedule")}>Reschedule</Link></EButton>
        <EButton asChild size="sm" variant="outline"><Link href={`${jobDetailTabHref(jobId, "messages")}#chat`}>Message client</Link></EButton>
        <EButton asChild size="sm" variant="outline" className="text-[hsl(var(--e-danger))]">
          <Link href={jobDetailTabHref(jobId, "schedule")} aria-describedby="peek-cancel-hint">Cancel job</Link>
        </EButton>
      </div>
      <p id="peek-cancel-hint" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Cancelling uses &ldquo;Skip this clean&rdquo; on the job&rsquo;s Schedule tab, with its own confirmation.
      </p>
    </ESidePanel>
  );
}
