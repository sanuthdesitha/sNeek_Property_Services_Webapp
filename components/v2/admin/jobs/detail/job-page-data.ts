/**
 * Everything the job page's server components render from, built once by the
 * page. A plain module (no "use client"): server components import its types.
 */
import type { JobContinuationRow, TaskRequestRow } from "@/components/v2/admin/jobs/job-detail-reviews";
import type { SubmissionRow } from "@/components/v2/admin/jobs/submission-review";
import type { BriefingProof } from "@/lib/jobs/job-page/briefing";
import type { JobPageJob, JobPageRelated } from "@/lib/jobs/job-page/load";
import type { JobPageManageJob } from "@/lib/jobs/job-page/rows";
import type { JobPageModel, JobPageViewer } from "@/lib/jobs/job-page/view-model";

export type JobPanelAssignment = {
  id: string;
  isPrimary: boolean;
  responseStatus: string;
  userId: string;
  name: string;
  email: string | null;
};

export type JobPageData = {
  job: JobPageJob;
  related: JobPageRelated;
  model: JobPageModel;
  viewer: JobPageViewer;
  timeZone: string;
  propLabel: string;
  scheduledLabel: string;
  timeLabel: string;
  taskRows: TaskRequestRow[];
  continuationRows: JobContinuationRow[];
  submissionRows: SubmissionRow[];
  manageJob: JobPageManageJob;
  panelAssignments: JobPanelAssignment[];
  briefing: BriefingProof;
  pendingTaskCount: number;
  pendingContinuationCount: number;
};

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
