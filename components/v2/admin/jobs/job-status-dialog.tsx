"use client";

/**
 * Change status for one or more jobs through the existing reviewed bulk-status
 * flow: choose a status, review every job server-side, then apply the whole
 * batch or nothing. Used by the bulk bar, a row's menu and a board drop (which
 * limits the choice to the destination lane's statuses).
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { BulkStatusPreviewControls } from "./bulk-status-preview";
import { JobDialog } from "./job-dialog";
import { statusLabel } from "./job-row";
import { STATUS_CHANGE_TARGETS } from "./jobs-constants";

export type StatusChangeRequest = {
  jobIds: string[];
  /** Statuses offered; defaults to every status. */
  statuses?: readonly string[];
  /** e.g. "Move The Bondi Studio to In progress". */
  title?: string;
};

type StatusDialogProps = {
  request: StatusChangeRequest | null;
  viewsContext?: string;
  readOnly: boolean;
  onClose: () => void;
  onApplied: (count: number) => void;
};

export function JobStatusDialog({ request, viewsContext, readOnly, onClose, onApplied }: StatusDialogProps) {
  const statuses = request?.statuses ?? STATUS_CHANGE_TARGETS;
  const [status, setStatus] = useState<string>(statuses[0] ?? "ASSIGNED");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setStatus((request?.statuses ?? STATUS_CHANGE_TARGETS)[0] ?? "ASSIGNED");
  }, [request]);
  const count = request?.jobIds.length ?? 0;

  return (
    <JobDialog open={request !== null} title={request?.title ?? "Change status"} busy={busy} onClose={onClose}>
      <div className="space-y-4 text-[0.8125rem]">
        <label className="block">
          <span className="mb-1.5 block text-[0.75rem] font-[550] text-[hsl(var(--e-muted-foreground))]">Status</span>
          <select aria-label="New status" disabled={busy} value={status} onChange={(event) => setStatus(event.target.value)}
            className="h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3">
            {statuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
        </label>
        <p>Applies this status to {count === 1 ? "this job" : `the ${count} selected jobs`}.</p>
        {request && viewsContext && !readOnly ? (
          <BulkStatusPreviewControls jobIds={request.jobIds} status={status} context={viewsContext} onBusy={setBusy} onApplied={() => onApplied(count)} />
        ) : (
          <p role="alert">Reload Jobs outside read-only mode to review and apply changes.</p>
        )}
        <div className="flex justify-end border-t border-[hsl(var(--e-border))] pt-4">
          <EButton variant="outline" onClick={onClose} disabled={busy}>Cancel</EButton>
        </div>
      </div>
    </JobDialog>
  );
}
