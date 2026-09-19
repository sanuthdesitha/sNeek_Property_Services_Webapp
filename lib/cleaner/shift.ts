/** An offer belongs to the cleaner's assignment, not the team's overall job status. */
export function isCleanerShiftOffer(job: { status: string; assignments: { userId: string; responseStatus?: string }[] }, userId: string) {
  if (!["UNASSIGNED", "OFFERED", "ASSIGNED"].includes(job.status)) return false;
  const own = job.assignments.find(assignment => assignment.userId === userId);
  return own?.responseStatus === "PENDING" || (!own?.responseStatus && job.status === "OFFERED");
}
export const SHIFT_ROUTE_STATUSES = ["ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"];
export type ShiftRouteStop = { jobId: string; property: string; address: string; startTime: string | null; status: string };
