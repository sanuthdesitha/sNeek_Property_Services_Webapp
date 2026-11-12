/**
 * 3 · Dispatch — who is on the job and whether they accepted, "Change
 * cleaners" (the existing assign panel: add, remove, primary, resend the
 * offer by SMS or email), and the start-briefing acknowledgements with their
 * full proof (moved from the old Activity tab). Moved from the People tab.
 */
import Link from "next/link";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import type { TimelineStage } from "@/lib/jobs/job-page/timeline";
import { JobAssignPanel } from "../job-assign-panel";
import { JobDisclosure } from "./job-disclosure";
import { titleCase, type JobPageData } from "./job-page-data";
import { Muted, StageShell } from "./stage-shell";

function BriefingProofList({ data }: { data: JobPageData }) {
  const { rows, currentHash } = data.briefing;
  return (
    <div className="space-y-3">
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        What each cleaner confirmed they had read before clocking in, recorded at the moment of the tap and kept as proof. Times are {data.timeZone}.
      </p>
      {rows.map((row) => (
        <div key={row.userId} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-[550]">{row.name}</span>
              <EBadge tone="neutral" soft>{row.items.length} item{row.items.length === 1 ? "" : "s"}</EBadge>
              {row.stale ? <EBadge tone="warning" soft>Briefing edited since</EBadge> : null}
            </span>
            <span className="text-[0.75rem] tabular-nums text-[hsl(var(--e-muted-foreground))]">{row.completedAtLabel ?? "Time not recorded"}</span>
          </div>
          <ul className="mt-2 divide-y divide-[hsl(var(--e-border))] border-t border-[hsl(var(--e-border))]">
            {row.items.map((item) => (
              <li key={item.itemId} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                <span className="min-w-0">
                  <span className={item.title ? "" : "italic text-[hsl(var(--e-muted-foreground))]"}>{item.title ?? item.fallback}</span>
                  <span className="block break-all text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{item.itemId}</span>
                </span>
                <span className="shrink-0 text-[0.75rem] tabular-nums text-[hsl(var(--e-muted-foreground))]">{item.atLabel ?? "Time not recorded"}</span>
              </li>
            ))}
          </ul>
          {row.hash ? (
            <p className="mt-2 break-all text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
              Signed against briefing fingerprint <span className="tabular-nums">{row.hash}</span>
              {row.stale ? <> · job now reads <span className="tabular-nums">{currentHash}</span></> : null}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function StageDispatch({ data, stage, collapsed }: { data: JobPageData; stage: TimelineStage; collapsed: boolean }) {
  const { job } = data;
  const unassigned = job.status === "UNASSIGNED" || job.status === "OFFERED";
  const editable = !data.viewer.readOnly && job.status !== "CANCELLED";
  const actions = editable ? (
    <EButton asChild size="sm" variant="ghost"><Link href="#dispatch-change">Change cleaners</Link></EButton>
  ) : null;
  return (
    <StageShell stage={stage} actions={actions} collapsed={collapsed}>
      {job.assignments.length === 0 ? (
        <Muted>{job.status === "CANCELLED" ? "No cleaner (released when the job was cancelled)." : "No cleaner yet."}</Muted>
      ) : (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {job.assignments.map((assignment) => (
            <li key={assignment.id}>
              <span className="font-[600]">{assignment.user?.name ?? assignment.user?.email ?? "Cleaner"}</span>{" "}
              {assignment.isPrimary ? <EBadge tone="neutral">Primary</EBadge> : null}{" "}
              <Muted>{titleCase(String(assignment.responseStatus))}</Muted>
            </li>
          ))}
        </ul>
      )}
      {data.briefing.rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Muted>Briefing read before clock-in:</Muted>
          {data.briefing.rows.map((row) => (
            <span key={row.userId}>
              {row.name}, {row.items.length} item{row.items.length === 1 ? "" : "s"}
              {row.completedAtLabel ? ` at ${row.completedAtLabel}` : ""} {row.stale ? <EBadge tone="warning" soft>Briefing edited since</EBadge> : null}
            </span>
          ))}
        </div>
      ) : null}
      {data.briefing.rows.length > 0 ? (
        <JobDisclosure id="briefing-proof" label="Show proof" description="Each item and the moment it was confirmed.">
          <BriefingProofList data={data} />
        </JobDisclosure>
      ) : null}
      {editable ? (
        <JobDisclosure
          id="dispatch-change"
          label="Change cleaners"
          description="Add, remove or make primary; resend the offer by SMS or email."
          defaultOpen={unassigned}
        >
          <JobAssignPanel
            jobId={job.id}
            jobLabel={data.propLabel}
            jobSubLabel={`${titleCase(String(job.jobType))} · ${data.scheduledLabel}${job.startTime ? ` · ${job.startTime}` : ""}`}
            assignments={data.panelAssignments}
          />
        </JobDisclosure>
      ) : null}
    </StageShell>
  );
}
