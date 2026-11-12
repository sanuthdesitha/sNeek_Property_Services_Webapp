import "server-only";
/**
 * The office's form submissions list (Forms → Results and stats →
 * Submissions; the classic /admin/forms "Submissions" tab moved here): server
 * paging and sorting through `list-query`, filters for form, property,
 * cleaner, submitted date (organisation calendar days), search and "with
 * warnings". Rows are summaries; a submission's answers and media load when
 * it is opened.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { listResponse, ListQueryError, type ListQuery, type ListResponse } from "@/lib/admin/list-query";
import { zonedDayBoundary } from "@/lib/lost-found/holding";
import { readSubmissionWarnings } from "./submission-warnings";

export const SUBMISSION_SORTS = ["submitted", "form", "property", "job", "cleaner"] as const;
export type SubmissionSort = (typeof SUBMISSION_SORTS)[number];

export type SubmissionFilters = {
  q: string;
  templateId: string | null;
  propertyId: string | null;
  cleanerId: string | null;
  from: string | null;
  to: string | null;
  withWarnings: boolean;
};

export type SubmissionListRow = {
  id: string;
  createdAt: string;
  jobId: string;
  form: { id: string; name: string; serviceType: string };
  property: { id: string; name: string; suburb: string | null } | null;
  job: { id: string; jobNumber: string | null; scheduledDate: string; status: string };
  cleaner: { id: string; name: string };
  mediaCount: number;
  warningCount: number;
  laundryReady: boolean | null;
};

export type SubmissionListResponse = ListResponse<SubmissionListRow, SubmissionSort> & {
  forms: Array<{ id: string; name: string }>;
  timeZone: string;
};

/** Above this many warned submissions the "with warnings" filter asks for a date range. */
const WARNING_SCAN_LIMIT = 5000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function idParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)?.trim() || null;
  if (value && !ID_PATTERN.test(value)) throw new ListQueryError(`${key} is not a valid id.`, "filter");
  return value;
}

export function parseSubmissionFilters(params: URLSearchParams): SubmissionFilters {
  return {
    q: (params.get("q") ?? "").trim().slice(0, 200),
    templateId: idParam(params, "templateId"),
    propertyId: idParam(params, "propertyId"),
    cleanerId: idParam(params, "cleanerId"),
    from: params.get("from")?.trim() || null,
    to: params.get("to")?.trim() || null,
    withWarnings: params.get("warnings") === "1",
  };
}

async function warnedSubmissionIds(): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT s."id" FROM "FormSubmission" s
    WHERE jsonb_typeof(s."data"->'__validationWarnings') = 'array' AND jsonb_array_length(s."data"->'__validationWarnings') > 0
    LIMIT ${WARNING_SCAN_LIMIT + 1}`;
  if (rows.length > WARNING_SCAN_LIMIT) throw new ListQueryError("Too many submissions with warnings; add a date range.", "filter");
  return rows.map((row) => row.id);
}

export async function submissionWhere(filters: SubmissionFilters, timeZone: string): Promise<Prisma.FormSubmissionWhereInput> {
  const and: Prisma.FormSubmissionWhereInput[] = [];
  if (filters.templateId) and.push({ templateId: filters.templateId });
  if (filters.propertyId) and.push({ job: { propertyId: filters.propertyId } });
  if (filters.cleanerId) and.push({ submittedById: filters.cleanerId });
  const createdAt: Prisma.DateTimeFilter = {};
  if (filters.from) {
    const start = zonedDayBoundary(filters.from, timeZone, "start");
    if (!start) throw new ListQueryError("from must be a date (YYYY-MM-DD).", "filter");
    createdAt.gte = start;
  }
  if (filters.to) {
    const end = zonedDayBoundary(filters.to, timeZone, "end");
    if (!end) throw new ListQueryError("to must be a date (YYYY-MM-DD).", "filter");
    createdAt.lte = end;
  }
  if (createdAt.gte || createdAt.lte) and.push({ createdAt });
  if (filters.q) {
    const contains = { contains: filters.q, mode: "insensitive" as const };
    and.push({ OR: [
      { template: { name: contains } },
      { job: { property: { name: contains } } },
      { job: { property: { suburb: contains } } },
      { job: { jobNumber: contains } },
      { submittedBy: { name: contains } },
    ] });
  }
  if (filters.withWarnings) and.push({ id: { in: await warnedSubmissionIds() } });
  return { AND: and };
}

function orderBy(query: ListQuery<SubmissionSort>): Prisma.FormSubmissionOrderByWithRelationInput[] {
  const dir = query.dir;
  const primary: Record<SubmissionSort, Prisma.FormSubmissionOrderByWithRelationInput> = {
    submitted: { createdAt: dir },
    form: { template: { name: dir } },
    property: { job: { property: { name: dir } } },
    job: { job: { scheduledDate: dir } },
    cleaner: { submittedBy: { name: { sort: dir, nulls: "last" } } },
  };
  return [primary[query.sort], { createdAt: "desc" }, { id: "asc" }];
}

const rowSelect = {
  id: true, createdAt: true, jobId: true, data: true, laundryReady: true,
  template: { select: { id: true, name: true, serviceType: true } },
  submittedBy: { select: { id: true, name: true, email: true } },
  job: { select: { id: true, jobNumber: true, scheduledDate: true, status: true, property: { select: { id: true, name: true, suburb: true } } } },
  _count: { select: { media: true } },
} satisfies Prisma.FormSubmissionSelect;

type RawRow = Prisma.FormSubmissionGetPayload<{ select: typeof rowSelect }>;

export function toSubmissionRow(row: RawRow): SubmissionListRow {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    jobId: row.jobId,
    form: { id: row.template.id, name: row.template.name, serviceType: String(row.template.serviceType) },
    property: row.job.property ? { id: row.job.property.id, name: row.job.property.name, suburb: row.job.property.suburb ?? null } : null,
    job: { id: row.job.id, jobNumber: row.job.jobNumber ?? null, scheduledDate: row.job.scheduledDate.toISOString(), status: String(row.job.status) },
    cleaner: { id: row.submittedBy.id, name: row.submittedBy.name ?? row.submittedBy.email ?? "Cleaner" },
    mediaCount: row._count.media,
    warningCount: readSubmissionWarnings(row.data).length,
    laundryReady: row.laundryReady ?? null,
  };
}

export async function listFormSubmissions(filters: SubmissionFilters, query: ListQuery<SubmissionSort>, timeZone: string): Promise<SubmissionListResponse> {
  const where = await submissionWhere(filters, timeZone);
  const [total, rows, forms] = await Promise.all([
    db.formSubmission.count({ where }),
    db.formSubmission.findMany({ where, orderBy: orderBy(query), skip: query.skip, take: query.take, select: rowSelect }),
    db.formTemplate.findMany({ where: { submissions: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);
  return { ...listResponse(rows.map(toSubmissionRow), total, query), forms, timeZone };
}
