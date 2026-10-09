import {
  JOB_PROGRESS_STEPS,
  jobProgress,
  statusBlockStyle,
} from "@/lib/jobs/status-presentation";
import { JobStatusIcon } from "./job-status-icon";
const stepStatuses = [
  "UNASSIGNED",
  "ASSIGNED",
  "EN_ROUTE",
  "IN_PROGRESS",
  "QA_REVIEW",
  "COMPLETED",
  "INVOICED",
];

export function JobStatusProgress({ status }: { status: string }) {
  const progress = jobProgress(status);
  return (
    <section
      aria-label="Job progress"
      className="rounded-lg border p-4 sm:p-5"
      style={statusBlockStyle(status)}
    >
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Job status: {progress.label}</p>
        {progress.step !== null && (
          <span className="text-xs opacity-70">
            Step {progress.step + 1} of {JOB_PROGRESS_STEPS.length}
          </span>
        )}
      </div>
      {progress.step !== null && (
        <>
          <div
            role="progressbar"
            aria-label="Job workflow"
            aria-valuemin={0}
            aria-valuemax={6}
            aria-valuenow={progress.step}
            aria-valuetext={progress.label}
            className="sr-only"
          />
          <ol className="job-stepper">
            {JOB_PROGRESS_STEPS.map((label, index) => (
              <li
                key={label}
                aria-current={index === progress.step ? "step" : undefined}
                data-reached={index <= progress.step!}
              >
                <JobStatusIcon
                  status={
                    index === progress.step ? status : stepStatuses[index]
                  }
                  animate={index === progress.step}
                />
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
