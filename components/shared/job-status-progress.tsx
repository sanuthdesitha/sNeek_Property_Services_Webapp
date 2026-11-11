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

/**
 * `compact` is for screens that already carry their own step controls (the
 * cleaner's job workspace). On a phone the seven-step rail is replaced by a
 * slim segmented bar, so the first screen shows the action, not the legend.
 */
export function JobStatusProgress({
  status,
  compact = false,
}: {
  status: string;
  compact?: boolean;
}) {
  const progress = jobProgress(status);
  return (
    <section
      aria-label="Job progress"
      className={compact ? "rounded-lg border p-3 sm:p-5" : "rounded-lg border p-4 sm:p-5"}
      style={statusBlockStyle(status)}
    >
      <div
        className={
          compact
            ? "mb-2 flex flex-wrap items-baseline justify-between gap-2 sm:mb-5"
            : "mb-5 flex flex-wrap items-baseline justify-between gap-2"
        }
      >
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
          {compact ? (
            <div className="flex gap-1 sm:hidden" aria-hidden>
              {JOB_PROGRESS_STEPS.map((label, index) => (
                <span
                  key={label}
                  className="h-1.5 flex-1 rounded-full bg-current"
                  style={{ opacity: index <= progress.step! ? 0.7 : 0.15 }}
                />
              ))}
            </div>
          ) : null}
          <ol className={compact ? "job-stepper max-sm:!hidden" : "job-stepper"}>
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
