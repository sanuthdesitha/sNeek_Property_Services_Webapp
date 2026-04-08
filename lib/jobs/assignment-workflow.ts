import { JobAssignmentResponseStatus, JobStatus } from "@prisma/client";

export const PRE_START_JOB_STATUSES = new Set<JobStatus>([
  JobStatus.UNASSIGNED,
  JobStatus.OFFERED,
  JobStatus.ASSIGNED,
]);

export const ACTIVE_ASSIGNMENT_RESPONSE_STATUSES = new Set<JobAssignmentResponseStatus>([
  JobAssignmentResponseStatus.PENDING,
  JobAssignmentResponseStatus.ACCEPTED,
]);

export function isAcceptedAssignment(status: JobAssignmentResponseStatus | null | undefined) {
  return status === JobAssignmentResponseStatus.ACCEPTED;
}

export function isPendingAssignment(status: JobAssignmentResponseStatus | null | undefined) {
  return status === JobAssignmentResponseStatus.PENDING;
}

export function formatAssignmentResponseLabel(status: JobAssignmentResponseStatus | null | undefined) {
  switch (status) {
    case JobAssignmentResponseStatus.ACCEPTED:
      return "Accepted";
    case JobAssignmentResponseStatus.DECLINED:
      return "Declined";
    case JobAssignmentResponseStatus.TRANSFERRED:
      return "Transferred";
    case JobAssignmentResponseStatus.PENDING:
    default:
      return "Awaiting confirmation";
  }
}

export function formatJobStatusLabel(status: JobStatus | string | null | undefined) {
  switch (status) {
    case JobStatus.OFFERED:
      return "Awaiting confirmation";
    case "EN_ROUTE" as JobStatus:
      return "On the way";
    default:
      return String(status ?? "")
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (part) => part.toUpperCase());
  }
}

export function derivePreStartJobStatus(
  currentStatus: JobStatus,
  assignments: Array<{
    removedAt?: Date | null;
    responseStatus?: JobAssignmentResponseStatus | null;
  }>
) {
  if (!PRE_START_JOB_STATUSES.has(currentStatus)) {
    return currentStatus;
  }

  const activeAssignments = assignments.filter(
    (assignment) =>
      !assignment.removedAt &&
      ACTIVE_ASSIGNMENT_RESPONSE_STATUSES.has(
        assignment.responseStatus ?? JobAssignmentResponseStatus.PENDING
      )
  );

  if (activeAssignments.length === 0) {
    return JobStatus.UNASSIGNED;
  }

  if (
    activeAssignments.some((assignment) =>
      isAcceptedAssignment(assignment.responseStatus ?? JobAssignmentResponseStatus.PENDING)
    )
  ) {
    return JobStatus.ASSIGNED;
  }

  return JobStatus.OFFERED;
}
