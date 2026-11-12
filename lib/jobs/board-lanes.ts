/**
 * Jobs board lanes over the full status ladder. Shared by the board route
 * (which counts and reads each lane on the server for the current filters)
 * and the board view (which renders them and offers drops).
 *
 * A drop never changes a status by itself: it opens the existing bulk-status
 * review for that one job, restricted to the destination lane's statuses, and
 * only the reviewed batch is applied (`lib/jobs/bulk-status-store.ts`). The
 * same rules apply as for the bulk action: invoiced jobs are locked.
 */
import type { JobStatus } from "@prisma/client";

export type JobsBoardLaneId = "unassigned" | "scheduled" | "inprogress" | "done";

export type JobsBoardLaneDefinition = {
  id: JobsBoardLaneId;
  label: string;
  statuses: JobStatus[];
};

export const JOBS_BOARD_LANES: readonly JobsBoardLaneDefinition[] = [
  { id: "unassigned", label: "Unassigned", statuses: ["UNASSIGNED", "OFFERED"] },
  { id: "scheduled", label: "Scheduled", statuses: ["ASSIGNED", "EN_ROUTE"] },
  { id: "inprogress", label: "In progress", statuses: ["IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"] },
  { id: "done", label: "Done", statuses: ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"] },
];

/** Jobs shown per lane; the lane count is always the real total. */
export const JOBS_BOARD_LANE_LIMIT = 25;

export function laneForStatus(status: string): JobsBoardLaneId | null {
  return JOBS_BOARD_LANES.find((lane) => (lane.statuses as string[]).includes(status))?.id ?? null;
}

/**
 * Whether a job may be offered a drop into a lane. Invoiced jobs are locked by
 * the bulk-status rules, and dropping into the lane it is already in changes
 * nothing.
 */
export function canDropIntoLane(status: string, lane: JobsBoardLaneId): boolean {
  if (status === "INVOICED") return false;
  return laneForStatus(status) !== lane;
}
