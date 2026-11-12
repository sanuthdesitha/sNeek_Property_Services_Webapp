/**
 * 5 · Submitted — the review step. "Approve and complete" and "Send back for
 * rework" are the existing quick QA score review (a pass completes the job;
 * a low score sends it to QA review and offers a rework job, which is never
 * created without confirmation). Around it: checklist answers, the laundry
 * outcome with its correction, photos, the AI photo review (a suggestion,
 * never a deduction until approved), task requests, draft evidence review and
 * task evidence with "Task photos in report". Moved from the old "Forms &
 * report", "Scope & requests", "Quality" and "Laundry" tabs.
 */
import Link from "next/link";
import { EBadge } from "@/components/v2/ui/primitives";
import { jobPageViewHref } from "@/lib/jobs/job-page/deep-link";
import type { TimelineStage } from "@/lib/jobs/job-page/timeline";
import { PhotoReviewPanel } from "@/components/v2/qa/photo-review-panel";
import { DraftEvidenceReview } from "../draft-evidence-review";
import { JobDetailManage, TaskRequestReviews } from "../job-detail-reviews";
import { QuickQaReview } from "../quick-qa-review";
import { AccessMediaGallery } from "../submission-review";
import { TaskEvidence } from "../task-evidence";
import { JobDisclosure } from "./job-disclosure";
import { titleCase, type JobPageData } from "./job-page-data";
import { Muted, StageSection, StageShell } from "./stage-shell";

const PHOTO_STRIP = 8;

function reworkLabels(data: JobPageData): string[] {
  const latest = data.submissionRows[0];
  const flags = new Set(data.model.reworkFlags);
  if (!latest || flags.size === 0) return [];
  const sections = Array.isArray((latest.schema as { sections?: unknown } | null)?.sections) ? ((latest.schema as { sections: unknown[] }).sections) : [];
  const labels: string[] = [];
  for (const section of sections) {
    const fields = section && typeof section === "object" && Array.isArray((section as { fields?: unknown }).fields) ? ((section as { fields: Array<{ id?: unknown; label?: unknown }> }).fields) : [];
    for (const field of fields) if (flags.has(String(field.id))) labels.push(String(field.label ?? field.id));
  }
  return labels;
}

export function StageSubmission({ data, stage, collapsed }: { data: JobPageData; stage: TimelineStage; collapsed: boolean }) {
  const { job, model } = data;
  const latest = data.submissionRows[0] ?? null;
  const reviewable = model.status === "SUBMITTED" || model.status === "QA_REVIEW";
  const viewOnly = data.viewer.readOnly ? "View only: your Jobs access does not allow changes." : null;
  const checklist = model.facts.find((fact) => fact.key === "checklist");
  const labels = reworkLabels(data);
  const pendingTasks = data.pendingTaskCount;
  const actions = reviewable ? (
    <>
      <QuickQaReview jobId={job.id} jobStatus={model.status} hasReview={model.qa !== null} intent="rework" triggerLabel="Send back for rework" disabledReason={viewOnly} />
      <QuickQaReview jobId={job.id} jobStatus={model.status} hasReview={model.qa !== null} intent="approve" triggerLabel="Approve and complete" disabledReason={viewOnly} />
    </>
  ) : null;

  return (
    <StageShell stage={stage} actions={actions} collapsed={collapsed}>
      {latest ? (
        <>
          <div className="flex flex-wrap items-stretch gap-2">
            <StageSection title="Checklist answers" aside={<Link href={jobPageViewHref(job.id, "answers")} className="text-[hsl(var(--e-accent-portal))] hover:underline">Open form answers</Link>} className="grow basis-64">
              <span>
                {checklist && !checklist.unknown ? `${checklist.value} required items answered.` : "Answer count not available for this form."}{" "}
                {labels.map((label) => (
                  <span key={label} className="mr-2 inline-block"><EBadge tone="warning" soft>Rework flag</EBadge> {label}</span>
                ))}
              </span>
              <Muted>
                {latest.stockTxs.length > 0 ? `Inventory used: ${latest.stockTxs.map((tx) => `${tx.quantity} ${tx.itemName}`).join(", ")}.` : "No inventory recorded on the form."}
                {latest.autoQaScore != null ? ` Auto QA ${Math.round(latest.autoQaScore)}.` : ""}
              </Muted>
            </StageSection>
            <StageSection title="Laundry outcome" className="grow basis-64">
              <span>
                {latest.laundryOutcome ? <EBadge tone={latest.laundryOutcome === "NOT_READY" ? "warning" : "success"} soft>{titleCase(latest.laundryOutcome)}</EBadge> : <Muted>Not set on the form</Muted>}
                {latest.bagLocation ? ` ${latest.bagLocation}` : ""}
              </span>
              {!data.viewer.readOnly ? (
                <JobDisclosure id="laundry-correct" label="Correct" description="Fix the submission's laundry ready flag, outcome and bag location.">
                  <JobDetailManage job={data.manageJob} section="laundry" />
                </JobDisclosure>
              ) : null}
            </StageSection>
          </div>
          <StageSection
            title={`Photos ${latest.media.length}`}
            aside={<Link href={jobPageViewHref(job.id, "photos")} className="text-[hsl(var(--e-accent-portal))] hover:underline">Open all</Link>}
          >
            {latest.media.length === 0 ? (
              <Muted>No photos on the submission.</Muted>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <AccessMediaGallery jobId={job.id} media={latest.media.slice(0, PHOTO_STRIP)} title="Submission photos" className="grid grid-cols-4 gap-1.5 sm:grid-cols-8" />
                {latest.media.length > PHOTO_STRIP ? <Muted>+{latest.media.length - PHOTO_STRIP}</Muted> : null}
              </div>
            )}
          </StageSection>
        </>
      ) : (
        <Muted>The cleaner has not submitted a job form yet.</Muted>
      )}
      <PhotoReviewPanel jobId={job.id} />
      <StageSection title="Task requests" aside={pendingTasks > 0 ? <EBadge tone="warning" soft>{pendingTasks} pending</EBadge> : null}>
        <TaskRequestReviews jobId={job.id} tasks={data.taskRows} />
      </StageSection>
      <DraftEvidenceReview jobId={job.id} />
      <TaskEvidence jobId={job.id} tasks={data.taskRows} includeInReport={model.meta.includeTaskPhotosInReport !== false} />
    </StageShell>
  );
}
