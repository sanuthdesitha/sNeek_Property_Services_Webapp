"use client";

/**
 * "Assign cleaners" for the job page assign panel and the Calendar. Since
 * 2026-11 it renders the shared `AssignDialog` (board "Everyday dialogs and
 * sheets"), so every entry point has one window. The request is unchanged:
 *   POST /api/admin/jobs/:id/assign { userIds, primaryUserId?, confirmLeaveConflict? }
 * An empty list clears every assignee. Leave and expired documents show in the
 * list before Save; the server's 409 and "Assign anyway" still apply, and a
 * replaced primary still offers the unsent client note afterwards.
 */
import { AssignDialog, type AssignCleaner } from "./assign-dialog";

export type { AssignCleaner } from "./assign-dialog";

export function AssignCleanersModal({
  open,
  onClose,
  jobId,
  jobLabel,
  jobSubLabel,
  context,
  phoneTitle,
  cleaners,
  cleanersState,
  initialAssignedIds,
  initialPrimaryId,
  onAssigned,
}: {
  open: boolean;
  onClose: () => void;
  jobId: string | null;
  jobLabel?: string;
  jobSubLabel?: string;
  /** Context line above the title; defaults to the label and sub-label. */
  context?: string;
  phoneTitle?: string;
  cleaners: AssignCleaner[];
  cleanersState?: "loading" | "failed" | "ready";
  initialAssignedIds?: string[];
  initialPrimaryId?: string | null;
  /** Called after a successful assign so the caller can refetch. */
  onAssigned: () => void | Promise<void>;
}) {
  const target = jobId
    ? {
        kind: "job" as const,
        jobId,
        context: context ?? [jobLabel ?? "Job", jobSubLabel].filter(Boolean).join(" · "),
        phoneTitle: phoneTitle ?? `Assign · ${jobLabel ?? "Job"}`,
        initialAssignedIds,
        initialPrimaryId,
      }
    : null;
  return <AssignDialog open={open && Boolean(jobId)} target={target} cleaners={cleaners} cleanersState={cleanersState} onClose={onClose} onAssigned={() => onAssigned()} />;
}
