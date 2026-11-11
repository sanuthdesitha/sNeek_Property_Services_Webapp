/**
 * Client-side copies of server rules the Jobs page needs to label its
 * controls. The server stays authoritative: these only decide what to offer.
 */
import { JobStatus, JobType } from "@prisma/client";

/** Mirrors `REMINDABLE_STATUSES` in `lib/jobs/job-reminder.ts`. */
export const REMINDABLE_JOB_STATUSES = [JobStatus.PAUSED, JobStatus.IN_PROGRESS, JobStatus.SUBMITTED] as const;

/** Every JobStatus, in workflow order, for the Status filter and bulk change. */
export const ALL_JOB_STATUSES: readonly JobStatus[] = Object.values(JobStatus);

export const JOB_TYPE_VALUES: readonly JobType[] = Object.values(JobType);

export type JobsPersonOption = { id: string; name: string; email: string };
export type JobsClientOption = { id: string; name: string };
