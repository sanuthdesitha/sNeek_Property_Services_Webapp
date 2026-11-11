/**
 * The Jobs list filter: one `where` builder shared by `GET /api/jobs` (list,
 * count and export), the Jobs board lanes and the view-tab counts, so every
 * figure on the Jobs page answers the same question.
 *
 * Moved out of `app/api/jobs/route.ts` unchanged in meaning. Additions:
 * - `status` may be a list (the Status chip covers every JobStatus). A single
 *   status keeps the original equality shape; several become `{ in: [...] }`.
 * - `ids` restricts the result to selected jobs (export of a selection).
 */
import { JobStatus, Role, type JobType } from "@prisma/client";

export type JobsWhereParams = {
  /** One status, several statuses, or null for any. */
  status: JobStatus | JobStatus[] | null;
  statusGroup: string | null;
  jobType: JobType | null;
  propertyId: string | null;
  clientId: string | null;
  /** A user id, or "unassigned" for jobs nobody is on. */
  cleanerId: string | null;
  date: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  search: string;
  invoiced: string | null;
  /** Restrict to these job ids (selected rows). Null or empty = no restriction. */
  ids?: string[] | null;
  role: Role;
  userId: string;
};

export type JobsWhere = Record<string, unknown>;

const COMPLETED_STATUSES: JobStatus[] = [JobStatus.COMPLETED, JobStatus.INVOICED];
const ALL_STATUSES = new Set<string>(Object.values(JobStatus));

/** The most selected ids one request may carry. */
export const MAX_JOB_ID_FILTER = 500;

export class JobsFilterError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "JobsFilterError";
  }
}

/**
 * Parse `?status=` for the paginated list: a comma-separated list of real
 * JobStatus values. An unknown value is refused rather than ignored, so the
 * list never quietly shows every status when one was asked for.
 */
export function parseStatusList(raw: string | null): JobStatus[] | null {
  if (raw === null || raw.trim() === "") return null;
  const values = Array.from(new Set(raw.split(",").map((value) => value.trim()).filter(Boolean)));
  if (values.length === 0) return null;
  const unknown = values.filter((value) => !ALL_STATUSES.has(value));
  if (unknown.length > 0) throw new JobsFilterError(`Unknown job status: ${unknown.join(", ")}.`);
  return values as JobStatus[];
}

/** Parse `?ids=` (comma-separated job ids) for a selection export. */
export function parseIdList(raw: string | null): string[] | null {
  if (raw === null || raw.trim() === "") return null;
  const ids = Array.from(new Set(raw.split(",").map((value) => value.trim()).filter(Boolean)));
  if (ids.length > MAX_JOB_ID_FILTER) throw new JobsFilterError(`Select at most ${MAX_JOB_ID_FILTER} jobs.`);
  if (ids.some((id) => !/^[a-zA-Z0-9_-]{1,128}$/.test(id))) throw new JobsFilterError("Invalid job selection.");
  return ids;
}

function statusCondition(status: JobsWhereParams["status"]): unknown {
  if (status === null) return undefined;
  if (Array.isArray(status)) return status.length === 1 ? status[0] : { in: status };
  return status;
}

export function buildJobsWhere(params: JobsWhereParams): JobsWhere {
  const where: JobsWhere = {};

  const explicitStatus = statusCondition(params.status);
  if (explicitStatus !== undefined) {
    where.status = explicitStatus;
  } else if (params.statusGroup === "active") {
    where.status = { notIn: COMPLETED_STATUSES };
  } else if (params.statusGroup === "completed") {
    where.status = { in: COMPLETED_STATUSES };
  }

  if (params.jobType) where.jobType = params.jobType;
  if (params.propertyId) where.propertyId = params.propertyId;
  if (params.clientId) where.property = { clientId: params.clientId };
  if (params.ids && params.ids.length > 0) where.id = { in: params.ids };

  if (params.search) {
    // Prisma contains uses LIKE: treat user-entered wildcards literally.
    const contains = params.search.replace(/[\\%_]/g, "\\$&");
    const text = { contains, mode: "insensitive" };
    where.OR = [
      { jobNumber: text },
      { property: { name: text } },
      { property: { suburb: text } },
      { property: { client: { name: text } } },
      { assignments: { some: { removedAt: null, user: { name: text } } } },
    ];
  }
  // Keep invoice alternatives separate from search and the explicit status.
  if (params.invoiced === "yes") {
    where.AND = [{ OR: [{ status: JobStatus.INVOICED }, { invoiceLines: { some: {} } }] }];
  } else if (params.invoiced === "no") {
    where.AND = [{ status: { not: JobStatus.INVOICED }, invoiceLines: { none: {} } }];
  }

  // Set before the CLEANER branch below so that branch always wins: a
  // cleaner may only ever see their own jobs, whatever they pass here.
  if (params.cleanerId) {
    where.assignments =
      params.cleanerId === "unassigned"
        ? { none: { removedAt: null } }
        : { some: { userId: params.cleanerId, removedAt: null } };
  }

  if (params.date) {
    const d = new Date(params.date);
    // Ignore an unparseable date rather than passing Invalid Date to Prisma (500).
    if (!Number.isNaN(d.getTime())) {
      where.scheduledDate = { gte: d, lt: new Date(d.getTime() + 86400000) };
    }
  } else if (params.dateFrom || params.dateTo) {
    const dateRange: Record<string, Date> = {};
    if (params.dateFrom) {
      const from = new Date(`${params.dateFrom}T00:00:00.000Z`);
      if (!Number.isNaN(from.getTime())) dateRange.gte = from;
    }
    if (params.dateTo) {
      // scheduledDate is a UTC date-only key, independent of the server timezone.
      const to = new Date(`${params.dateTo}T00:00:00.000Z`);
      if (!Number.isNaN(to.getTime())) dateRange.lt = new Date(to.getTime() + 86400000);
    }
    if (Object.keys(dateRange).length > 0) where.scheduledDate = dateRange;
  }

  if (params.role === Role.CLEANER) {
    where.assignments = { some: { userId: params.userId, removedAt: null } };
    // Skipped cleans are not part of a cleaner's actionable workload.
    where.cleanSkipStatus = { not: "SKIPPED" };
  }

  return where;
}

/** Read the shared filter params from a request URL (status handled by the caller). */
export function readJobsFilterParams(searchParams: URLSearchParams) {
  return {
    statusGroup: searchParams.get("statusGroup"),
    jobType: searchParams.get("jobType") as JobType | null,
    propertyId: searchParams.get("propertyId"),
    clientId: searchParams.get("clientId"),
    cleanerId: searchParams.get("cleanerId"),
    date: searchParams.get("date"),
    dateFrom: searchParams.get("dateFrom"),
    dateTo: searchParams.get("dateTo"),
    search: (searchParams.get("search") ?? "").slice(0, 200).trim(),
    invoiced: searchParams.get("invoiced"),
  };
}

export function isJobsFilterError(error: unknown): error is JobsFilterError {
  return error instanceof JobsFilterError;
}
