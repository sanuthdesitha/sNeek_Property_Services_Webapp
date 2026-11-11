/**
 * Reads and answers GET /api/admin/cases?shape=summary.
 *
 * Query: queue, q, caseType, status, assigneeUserId, jobId, reportId, clientId,
 * propertyId, page, pageSize, sort (sla|created|updated|priority|type), dir,
 * countsOnly=1. An unknown queue, sort or direction is refused (400).
 */
import { listCaseAssignees } from "@/lib/cases/service";
import { listResponse, ListQueryError, parseListQuery, readQueryValue, type ListResponse } from "@/lib/admin/list-query";
import { CASE_SORTS, CASE_SORT_DEFAULT_DIR, isKnownCaseQueueValue, parseCaseQueue, type CaseFilterInput, type CaseQueue, type CaseSort } from "@/lib/cases/queues";
import { CASE_STATUSES } from "@/lib/cases/status";
import {
  buildQueueContext,
  countCaseQueues,
  listCaseSummaries,
  type CaseQueueCounts,
  type CaseSummary,
  type CaseTypeCounts,
} from "@/lib/cases/summaries";

export const CASE_PAGE_SIZE = 50;

export type CaseSummaryRequest = {
  queue: CaseQueue;
  filters: CaseFilterInput;
  countsOnly: boolean;
  sort: CaseSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

const ID = /^[A-Za-z0-9_-]{1,128}$/;

function readId(params: URLSearchParams, key: string): string | null {
  const value = readQueryValue(params, key);
  if (value === undefined) return null;
  if (!ID.test(value)) throw new ListQueryError(`${key} is not a valid id.`, "filter");
  return value;
}

export function readCaseSummaryRequest(params: URLSearchParams): CaseSummaryRequest {
  const rawQueue = readQueryValue(params, "queue") ?? readQueryValue(params, "view");
  if (rawQueue !== undefined && !isKnownCaseQueueValue(rawQueue)) {
    throw new ListQueryError(`Unknown queue "${rawQueue}".`, "filter");
  }
  const sortValue = readQueryValue(params, "sort");
  const defaultSort: CaseSort = "sla";
  const effectiveSort = (sortValue ?? defaultSort) as CaseSort;
  const list = parseListQuery(params, {
    sortable: CASE_SORTS,
    defaultSort,
    defaultDir: (CASE_SORTS as readonly string[]).includes(effectiveSort) ? CASE_SORT_DEFAULT_DIR[effectiveSort] : "asc",
    defaultPageSize: CASE_PAGE_SIZE,
    maxPageSize: 100,
  });
  const status = readQueryValue(params, "status");
  if (status !== undefined && status !== "ALL" && !(CASE_STATUSES as readonly string[]).includes(status)) {
    throw new ListQueryError(`Unknown status "${status}".`, "filter");
  }
  const caseType = readQueryValue(params, "caseType");
  const assignee = readQueryValue(params, "assigneeUserId");
  if (assignee !== undefined && assignee !== "__unassigned" && !ID.test(assignee)) {
    throw new ListQueryError("assigneeUserId is not a valid id.", "filter");
  }
  return {
    queue: parseCaseQueue(rawQueue, "open"),
    filters: {
      q: (readQueryValue(params, "q") ?? "").slice(0, 200) || null,
      caseType: caseType && caseType !== "ALL" ? caseType.toUpperCase().slice(0, 40) : null,
      status: status && status !== "ALL" ? status : null,
      assigneeUserId: assignee && assignee !== "ALL" ? assignee : null,
      jobId: readId(params, "jobId"),
      reportId: readId(params, "reportId"),
      clientId: readId(params, "clientId"),
      propertyId: readId(params, "propertyId"),
    },
    countsOnly: readQueryValue(params, "countsOnly") === "1",
    sort: list.sort,
    dir: list.dir,
    page: list.page,
    pageSize: list.pageSize,
    skip: list.skip,
    take: list.take,
  };
}

export type CaseViewer = { id: string; name: string | null; email: string | null; role: string | null };

export type CaseCountsResponse = { queue: CaseQueue; counts: CaseQueueCounts; typeCounts: CaseTypeCounts };

export type CaseSummaryResponse = ListResponse<CaseSummary, CaseSort> &
  CaseCountsResponse & {
    assignees: Awaited<ReturnType<typeof listCaseAssignees>>;
    viewer: CaseViewer;
  };

export async function buildCaseSummaryResponse(
  request: CaseSummaryRequest,
  user: { id: string; name?: string | null; email?: string | null; role?: string | null },
): Promise<CaseSummaryResponse | CaseCountsResponse> {
  const context = await buildQueueContext(user.id);
  const countsPromise = countCaseQueues(request.queue, request.filters, context);
  if (request.countsOnly) {
    const { counts, typeCounts } = await countsPromise;
    return { queue: request.queue, counts, typeCounts };
  }
  const [{ rows, total }, { counts, typeCounts }, assignees] = await Promise.all([
    listCaseSummaries(request, context),
    countsPromise,
    listCaseAssignees(),
  ]);
  return {
    ...listResponse(rows, total, request),
    queue: request.queue,
    counts,
    typeCounts,
    assignees,
    viewer: { id: user.id, name: user.name ?? null, email: user.email ?? null, role: user.role ?? null },
  };
}
