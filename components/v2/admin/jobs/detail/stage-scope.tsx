/**
 * 2 · Scope — what was asked for: extras, admin tasks, notices, tags and the
 * internal note, with "Add extra" (the existing quote-extras panel, which
 * emails the client the new total) and "Edit scope and notes" (the existing
 * scope editor). Moved from the old "Scope & requests" tab.
 */
import Link from "next/link";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { isInternalJobTag } from "@/lib/jobs/meta";
import { formatMoney } from "@/lib/jobs/job-page/money";
import type { TimelineStage } from "@/lib/jobs/job-page/timeline";
import { JobDetailManage } from "../job-detail-reviews";
import { JobExtrasPanel } from "../job-extras-panel";
import { JobDisclosure } from "./job-disclosure";
import type { JobPageData } from "./job-page-data";
import { Muted, StageShell } from "./stage-shell";

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[hsl(var(--e-muted-foreground))]">{term}</dt>
      <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

export function StageScope({ data, stage, collapsed }: { data: JobPageData; stage: TimelineStage; collapsed: boolean }) {
  const { meta } = data.model;
  const adminTasks = data.job.jobTasks.filter((task) => String(task.source) === "ADMIN");
  const tags = meta.tags;
  const editable = !data.viewer.readOnly && data.job.status !== "CANCELLED";
  const actions = editable ? (
    <>
      <EButton asChild size="sm" variant="outline"><Link href="#scope-extras">Add extra</Link></EButton>
      <EButton asChild size="sm" variant="ghost"><Link href="#scope-edit">Edit scope and notes</Link></EButton>
    </>
  ) : null;
  return (
    <StageShell stage={stage} actions={actions} collapsed={collapsed}>
      <dl className="m-0 grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
        <Row term="Extras">
          {meta.additionals.length === 0 ? (
            <Muted>None</Muted>
          ) : (
            meta.additionals.map((extra) => {
              const price = meta.additionalPrices?.[extra.id];
              return (
                <span key={extra.id} className="mr-3 inline-block">
                  {extra.label} {typeof price === "number" ? <span className="tabular-nums">{formatMoney(price)} </span> : null}
                  <EBadge tone={typeof price === "number" ? "info" : "success"} soft>{typeof price === "number" ? "Added after booking" : "In quoted total"}</EBadge>
                </span>
              );
            })
          )}
        </Row>
        <Row term="Admin tasks">
          {adminTasks.length === 0 ? <Muted>None</Muted> : adminTasks.map((task) => (
            <span key={task.id} className="mr-3 inline-block">
              {task.title} {task.requiresPhoto ? <EBadge tone="info" soft>Photo</EBadge> : null} {task.requiresNote ? <EBadge tone="info" soft>Note</EBadge> : null}
            </span>
          ))}
        </Row>
        <Row term="Notices">
          {meta.notices.length === 0 ? <Muted>None</Muted> : meta.notices.map((notice) => (
            <span key={notice.id} className="block">
              {notice.body} {notice.urgency === "IMPORTANT" ? <EBadge tone="warning" soft>Important</EBadge> : null}
            </span>
          ))}
        </Row>
        <Row term="Tags">
          {tags.length === 0 ? <Muted>None</Muted> : tags.map((tag) => (
            <span key={tag} className="mr-1.5 inline-block"><EBadge tone="neutral">{isInternalJobTag(tag) ? `${tag} (internal)` : tag}</EBadge></span>
          ))}
        </Row>
        <Row term="Internal note">{meta.internalNoteText ? meta.internalNoteText : <Muted>None</Muted>}</Row>
        {meta.isDraft ? <Row term="Draft"><EBadge tone="neutral" soft>Draft, off dispatch until published</EBadge></Row> : null}
      </dl>
      {editable ? (
        <>
          <JobDisclosure id="scope-extras" label="Add extra" description="Quote-style extras; the client is emailed the updated total.">
            <JobExtrasPanel jobId={data.job.id} fixedPrice={data.job.fixedPrice} />
          </JobDisclosure>
          <JobDisclosure id="scope-edit" label="Edit scope and notes" description="Notes, internal note, key pickup, tags, draft, notices and admin tasks.">
            <JobDetailManage job={data.manageJob} section="scope" />
          </JobDisclosure>
        </>
      ) : null}
    </StageShell>
  );
}
