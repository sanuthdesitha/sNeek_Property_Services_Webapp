"use client";

/**
 * Assign / reassign cleaners and assign the QA inspector from the calendar,
 * reusing the SAME components the job pages use (`AssignCleanersModal`,
 * `QaAssignPanel`), so the calendar cannot drift from them. Both stay
 * reachable from every chip's menu and from the Agenda rows.
 */
import { EModal } from "@/components/v2/admin/estate-kit";
import { AssignCleanersModal } from "@/components/v2/admin/jobs/assign-cleaners-modal";
import { QaAssignPanel } from "@/components/v2/admin/jobs/qa-assign-panel";
import type { JobsPersonOption } from "@/components/v2/admin/jobs/jobs-constants";
import { mediumDayLabel } from "@/lib/calendar/range";
import type { CalendarJob } from "@/lib/calendar/types";

type DialogsProps = {
  assignJob: CalendarJob | null;
  qaJob: CalendarJob | null;
  cleaners: JobsPersonOption[];
  inspectors: JobsPersonOption[];
  inspectorsState: "loading" | "ready" | "error";
  onCloseAssign: () => void;
  onCloseQa: () => void;
  onChanged: () => void;
};

function subLabel(job: CalendarJob): string {
  return [job.jobType.replace(/_/g, " ").toLowerCase(), job.suburb, mediumDayLabel(job.day), job.startTime].filter(Boolean).join(" · ");
}

export function CalendarAssignDialogs({ assignJob, qaJob, cleaners, inspectors, inspectorsState, onCloseAssign, onCloseQa, onChanged }: DialogsProps) {
  return (
    <>
      <AssignCleanersModal
        open={Boolean(assignJob)}
        onClose={onCloseAssign}
        jobId={assignJob?.id ?? null}
        jobLabel={assignJob?.propertyName ?? "Job"}
        jobSubLabel={assignJob ? subLabel(assignJob) : undefined}
        cleaners={cleaners}
        initialAssignedIds={assignJob?.cleaners.map((cleaner) => cleaner.id) ?? []}
        initialPrimaryId={assignJob?.cleaners.find((cleaner) => cleaner.isPrimary)?.id ?? null}
        onAssigned={onChanged}
      />
      <EModal
        open={Boolean(qaJob)}
        onClose={() => { onCloseQa(); onChanged(); }}
        title="Assign QA inspector"
        eyebrow={qaJob?.propertyName ?? "Job"}
      >
        {qaJob ? (
          <div className="space-y-3">
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{subLabel(qaJob)}</p>
            {inspectorsState === "loading" ? <p role="status" className="text-[0.8125rem]">Loading inspectors…</p> : null}
            {inspectorsState === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Inspectors could not be loaded. Close and try again.</p> : null}
            {inspectorsState === "ready" && inspectors.length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-warning))]">
                No QA inspectors or ops managers found. Check that at least one active account holds one of those roles.
              </p>
            ) : null}
            {inspectorsState === "ready" && inspectors.length > 0 ? (
              <QaAssignPanel
                jobId={qaJob.id}
                current={qaJob.qa ? { id: qaJob.qa.id, status: qaJob.qa.status, assignedToId: qaJob.qa.assignedToId, assignedToName: qaJob.qa.assignedToName } : null}
                // Names already carry "(Ops)" for operations managers (reference data), so no role suffix is added again.
                inspectors={inspectors.map((person) => ({ id: person.id, name: person.name || null, email: person.email, role: "" }))}
              />
            ) : null}
          </div>
        ) : null}
      </EModal>
    </>
  );
}
