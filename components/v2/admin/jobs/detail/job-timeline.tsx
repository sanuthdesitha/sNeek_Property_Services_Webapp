/**
 * The job timeline, Booking → Invoice and pay, top to bottom. Once the job is
 * completed or invoiced, finished stages collapse to their headline (their
 * content one click away), as drawn for the invoiced state.
 */
import type { TimelineStage, TimelineStageKey } from "@/lib/jobs/job-page/timeline";
import type { JobPageData } from "./job-page-data";
import { StageBooking } from "./stage-booking";
import { StageDispatch } from "./stage-dispatch";
import { StageLaundry, StageInvoice } from "./stage-laundry-invoice";
import { StageOnSite } from "./stage-on-site";
import { StageQuality, StageReport } from "./stage-quality-report";
import { StageScope } from "./stage-scope";
import { StageSubmission } from "./stage-submission";

const FINISHED = new Set(["COMPLETED", "INVOICED"]);

function renderStage(key: TimelineStageKey, props: { data: JobPageData; stage: TimelineStage; collapsed: boolean }, now: Date) {
  switch (key) {
    case "booking":
      return <StageBooking {...props} />;
    case "scope":
      return <StageScope {...props} />;
    case "dispatch":
      return <StageDispatch {...props} />;
    case "site":
      return <StageOnSite {...props} now={now} />;
    case "submitted":
      return <StageSubmission {...props} />;
    case "qa":
      return <StageQuality {...props} />;
    case "report":
      return <StageReport {...props} />;
    case "laundry":
      return <StageLaundry {...props} />;
    case "invoice":
      return <StageInvoice {...props} />;
  }
}

export function JobTimeline({ data, now }: { data: JobPageData; now: Date }) {
  const finished = FINISHED.has(data.model.status);
  return (
    <div className="relative flex min-w-0 flex-col gap-2.5 pl-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-0.5 before:bg-[hsl(var(--e-border))] before:content-['']">
      {data.model.timeline.map((stage) => (
        <div key={stage.key} className="min-w-0">
          {renderStage(stage.key, { data, stage, collapsed: finished && stage.state === "done" }, now)}
        </div>
      ))}
    </div>
  );
}
