import { deriveReadiness } from "./progress";

export const QA_QUEUE_STAGES = {
  WAITING: "Awaiting cleaner evidence",
  READY: "Ready to inspect",
  PLANNED: "Visit planned",
  INSPECTING: "In inspection",
  BLOCKED: "Blocked",
  COMPLETED: "Reviewed",
} as const;

export type QaQueueStage = keyof typeof QA_QUEUE_STAGES;

type QueueJob = {
  status?: string | null;
  isRework?: boolean | null;
  inspectionReadiness?: string | null;
  formSubmissions?: unknown[];
};

export function qaQueueReadiness(job: QueueJob | null | undefined) {
  const explicit = job?.inspectionReadiness;
  if (explicit === "READY" || explicit === "CLEANING" || explicit === "REWORK_PENDING") return explicit;
  return deriveReadiness({ ...job, hasSubmission: Boolean(job?.formSubmissions?.length) });
}

/** Presentation of existing readiness and assignment state; never grants access. */
export function qaQueueStage(job: QueueJob | null | undefined, assignment?: {
  status?: string | null;
  scheduledFor?: string | Date | null;
} | null): { stage: QaQueueStage; explanation: string | null } {
  if (!job) return { stage: "BLOCKED", explanation: "Job details are unavailable. Refresh the queue before inspecting." };
  if (assignment?.status === "CANCELLED") return { stage: "BLOCKED", explanation: "This inspection was cancelled. Contact operations before proceeding." };
  if (assignment?.status === "COMPLETED") return { stage: "COMPLETED", explanation: null };
  if (assignment?.status === "IN_PROGRESS") return { stage: "INSPECTING", explanation: null };
  const readiness = qaQueueReadiness(job);
  if (readiness !== "READY") return {
    stage: "WAITING",
    explanation: readiness === "REWORK_PENDING"
      ? "Waiting for the rework submission. Starting an inspection early requires a reason."
      : "Waiting for the cleaner's submission. Starting an inspection early requires a reason.",
  };
  if (assignment?.scheduledFor && Number.isFinite(new Date(assignment.scheduledFor).getTime())) {
    return { stage: "PLANNED", explanation: "Evidence is ready; a visit time has been scheduled." };
  }
  return { stage: "READY", explanation: null };
}
