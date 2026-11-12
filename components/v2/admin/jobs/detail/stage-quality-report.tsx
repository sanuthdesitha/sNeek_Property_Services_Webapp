/**
 * 6 · Quality check — the QA inspector assignment, the latest QA result and
 * the quick QA review (moved from the Quality tab).
 * 7 · Report — download, client visibility, share, the QA report's
 * visibility to the cleaner, and every document the job produced, including
 * damage reports (moved from the "Forms & report" tab).
 */
import { formatInTimeZone } from "date-fns-tz";
import { EBadge } from "@/components/v2/ui/primitives";
import type { TimelineStage } from "@/lib/jobs/job-page/timeline";
import { FormsQaCentre } from "../forms-qa-centre";
import { QaAssignPanel } from "../qa-assign-panel";
import { QuickQaReview } from "../quick-qa-review";
import { ReportActions } from "../report-actions";
import type { JobPageData } from "./job-page-data";
import { Muted, StageShell } from "./stage-shell";

export function StageQuality({ data, stage, collapsed }: { data: JobPageData; stage: TimelineStage; collapsed: boolean }) {
  const { job, related, model } = data;
  const qa = model.qa;
  const assignment = related.qaAssignment;
  return (
    <StageShell stage={stage} collapsed={collapsed}>
      {qa ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="e-numeral text-[1.25rem] leading-none">{Math.round(qa.score)}</span>
          <EBadge tone={qa.passed ? "success" : "danger"} soft>{qa.passed ? "Passed" : "Failed"}</EBadge>
          <EBadge tone="neutral" soft>{qa.kind}</EBadge>
          <Muted>{formatInTimeZone(qa.createdAt, data.timeZone, "d MMM yyyy HH:mm")}</Muted>
          {qa.notes ? <p className="basis-full text-[hsl(var(--e-muted-foreground))]">{qa.notes}</p> : null}
        </div>
      ) : (
        <Muted>No QA review yet. Quick review records a score from 0 to 100 and can offer a rework job.</Muted>
      )}
      <>
          <QaAssignPanel
            jobId={job.id}
            current={
              assignment
                ? {
                    id: assignment.id,
                    status: String(assignment.status),
                    assignedToId: assignment.assignedToId,
                    assignedToName: assignment.assignedTo?.name ?? assignment.assignedTo?.email ?? null,
                    earlyStartReason: assignment.earlyStartReason,
                  }
                : null
            }
            inspectors={related.qaEligibleUsers.map((user) => ({ id: user.id, name: user.name, email: user.email, role: String(user.role) }))}
          />
          <div>
            <QuickQaReview jobId={job.id} jobStatus={model.status} hasReview={qa !== null} defaultScore={qa ? Math.round(qa.score) : 90} />
          </div>
      </>
    </StageShell>
  );
}

export function StageReport({ data, stage, collapsed }: { data: JobPageData; stage: TimelineStage; collapsed: boolean }) {
  const { job, model } = data;
  return (
    <StageShell stage={stage} collapsed={collapsed}>
      <ReportActions
        jobId={job.id}
        initialClientVisible={job.report?.clientVisible !== false}
        initialSentToClient={job.report?.sentToClient ?? false}
        clientEmail={job.property?.client?.email ?? ""}
        hasSubmission={job.formSubmissions.length > 0}
        hasQaReview={model.qa !== null}
        qaReviewId={model.qa?.id ?? null}
        initialQaCleanerVisible={model.qa?.cleanerReportVisible !== false}
      />
      <FormsQaCentre jobId={job.id} hasReport={job.report !== null} hasQaReview={model.qa !== null} />
    </StageShell>
  );
}
