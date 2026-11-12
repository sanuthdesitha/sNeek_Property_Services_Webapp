"use client";

/**
 * Tracking board pieces from the laundry portal board (3 Tracking): the stage
 * chips with real counts over the sets loaded for the chosen dates, and the
 * Issues list (failed pickups of the last seven days, with the reschedule or
 * the office decision they are waiting for). Count differences are listed by
 * the existing "Bag count differences" section on the same page.
 */
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { EPill } from "@/components/v2/ui/pill";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import { TRACKING_STAGES, failedPickupIssues, type TrackingStage } from "@/lib/laundry/tracking-stages";

export type StageFilter = TrackingStage | "all";

export function TrackingStageChips({ value, counts, total, onChange }: { value: StageFilter; counts: Record<TrackingStage, number>; total: number; onChange: (value: StageFilter) => void }) {
  const chips: Array<{ id: StageFilter; label: string; count: number }> = [{ id: "all", label: "All", count: total }, ...TRACKING_STAGES.map((stage) => ({ id: stage.id, label: stage.label, count: counts[stage.id] }))];
  return (
    <div role="group" aria-label="Stage" className="flex gap-1.5 overflow-x-auto pb-1">
      {chips.map((chip) => (
        <button key={chip.id} type="button" aria-pressed={value === chip.id} onClick={() => onChange(chip.id)} className={`min-h-11 shrink-0 rounded-full border px-3 text-[0.8125rem] ${value === chip.id ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary)/0.1)] font-[600]" : "border-[hsl(var(--e-border-strong))]"}`}>
          {chip.label} {chip.count}
        </button>
      ))}
    </div>
  );
}

type IssueTask = Parameters<typeof failedPickupIssues>[0][number];

export function TrackingIssues({ tasks }: { tasks: readonly IssueTask[] }) {
  const issues = failedPickupIssues(tasks, new Date());
  if (!issues.length) return null;
  return (
    <section aria-labelledby="tracking-issues" className="space-y-2">
      <h2 id="tracking-issues" className="e-eyebrow">Issues</h2>
      <ul className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
        {issues.map((issue) => (
          <li key={`${issue.taskId}:${issue.atIso}`} className="flex min-h-[52px] items-start gap-2.5 border-t border-[hsl(var(--e-border))] px-3 py-2.5 first:border-t-0">
            <EPill tone="bad">Failed</EPill>
            <span className="min-w-0 flex-1 text-[0.8125rem]">
              <Link href={`#task-${encodeURIComponent(issue.taskId)}`} className="block font-[600] hover:underline">{issue.propertyName} pickup, {formatInTimeZone(new Date(issue.atIso), SYDNEY_TZ, "EEE d MMM")}</Link>
              <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {issue.reason} · {issue.rescheduledTo ? `rescheduled to ${issue.rescheduledTo}` : issue.awaitingOffice ? "waiting for the office to decide" : "decided by the office"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
