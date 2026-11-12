/**
 * Case list summaries for the admin Cases inbox.
 *
 * Returns one page of SUMMARIES: no comment or attachment bodies, only counts
 * and the latest non-internal message (who, when and a short excerpt). The
 * conversation itself loads when a case is opened (GET /api/admin/cases/[id]).
 *
 * Sorting reads a handful of columns for every matching case, orders them with
 * the shared comparator (so "priority" and "type" can follow business ranks a
 * SQL ORDER BY cannot express) and then reads only the page's rows in full.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ensureLegacyDisputesMigrated } from "@/lib/cases/service";
import { normalizeUnifiedCaseStatus, type UnifiedCaseStatus } from "@/lib/cases/status";
import {
  CASE_QUEUES,
  CASE_TYPES,
  buildCaseFilterWhere,
  buildQueueWhere,
  compareCases,
  lastPublicMessageIsFromClient,
  needsReplyCandidateWhere,
  type CaseFilterInput,
  type CaseQueue,
  type CaseSort,
  type CaseSortKey,
  type CaseTypeKey,
  type QueueContext,
} from "@/lib/cases/queues";
import { parseCaseDescription } from "@/lib/issues/case-utils";

export type CasePerson = { id: string; name: string | null; email: string; role: string };

export type CaseLastMessage = {
  at: string;
  authorName: string;
  fromClient: boolean;
  excerpt: string;
};

export type CaseSummary = {
  id: string;
  title: string;
  status: UnifiedCaseStatus;
  severity: string;
  caseType: CaseTypeKey;
  slaBreachAt: string | null;
  createdAt: string;
  updatedAt: string;
  clientVisible: boolean;
  clientCanReply: boolean;
  jobId: string | null;
  reportId: string | null;
  clientId: string | null;
  propertyId: string | null;
  job: { id: string; jobNumber: string | null; scheduledDate: string | null } | null;
  client: { id: string; name: string } | null;
  property: { id: string; name: string; suburb: string | null } | null;
  assignedTo: CasePerson | null;
  invoiceRef: string | null;
  commentCount: number;
  attachmentCount: number;
  lastMessage: CaseLastMessage | null;
  /** The latest non-internal message is the client's. */
  clientReplied: boolean;
};

export type CaseQueueCounts = Record<CaseQueue, number>;
export type CaseTypeCounts = Record<CaseTypeKey, number>;

const EXCERPT_LENGTH = 140;

const summaryInclude = {
  job: { select: { id: true, jobNumber: true, scheduledDate: true, property: { select: { id: true, name: true, suburb: true } } } },
  client: { select: { id: true, name: true } },
  property: { select: { id: true, name: true, suburb: true } },
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
  _count: { select: { comments: true, attachments: true } },
  comments: {
    where: { isInternal: false },
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
    select: { body: true, createdAt: true, author: { select: { name: true, email: true, role: true } } },
  },
} satisfies Prisma.IssueTicketInclude;

type SummaryRow = Prisma.IssueTicketGetPayload<{ include: typeof summaryInclude }>;

function normalizeType(row: { caseType: string | null; source: string | null; title: string }): CaseTypeKey {
  const raw = String(row.caseType || row.source || row.title || "").trim().toUpperCase();
  return (CASE_TYPES as readonly string[]).includes(raw) ? (raw as CaseTypeKey) : "OTHER";
}

function readInvoiceRef(metadata: Prisma.JsonValue | null): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).invoiceRef;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function toCaseSummary(row: SummaryRow): CaseSummary {
  const latest = row.comments[0] ?? null;
  const fromClient = lastPublicMessageIsFromClient(latest?.author?.role);
  const plain = latest ? parseCaseDescription(latest.body).text || latest.body : "";
  return {
    id: row.id,
    title: row.title,
    status: normalizeUnifiedCaseStatus(row.status),
    severity: String(row.severity ?? "MEDIUM").toUpperCase(),
    caseType: normalizeType(row),
    slaBreachAt: row.slaBreachAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    clientVisible: row.clientVisible === true,
    clientCanReply: row.clientCanReply !== false,
    jobId: row.jobId,
    reportId: row.reportId,
    clientId: row.clientId,
    propertyId: row.propertyId,
    job: row.job ? { id: row.job.id, jobNumber: row.job.jobNumber ?? null, scheduledDate: row.job.scheduledDate?.toISOString() ?? null } : null,
    client: row.client ? { id: row.client.id, name: row.client.name } : null,
    property: row.property ?? row.job?.property ?? null,
    assignedTo: row.assignedTo ? { ...row.assignedTo, role: String(row.assignedTo.role) } : null,
    invoiceRef: readInvoiceRef(row.metadata),
    commentCount: row._count.comments,
    attachmentCount: row._count.attachments,
    lastMessage: latest
      ? {
          at: latest.createdAt.toISOString(),
          authorName: latest.author?.name?.trim() || latest.author?.email || (fromClient ? "Client" : "Unknown"),
          fromClient,
          excerpt: plain.replace(/\s+/g, " ").trim().slice(0, EXCERPT_LENGTH),
        }
      : null,
    clientReplied: fromClient,
  };
}

/** Open cases owned by the viewer whose latest public message is the client's. */
export async function findNeedsReplyIds(viewerId: string): Promise<string[]> {
  const candidates = await db.issueTicket.findMany({
    where: needsReplyCandidateWhere(viewerId),
    select: {
      id: true,
      comments: {
        where: { isInternal: false },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { author: { select: { role: true } } },
      },
    },
  });
  return candidates.filter((row) => lastPublicMessageIsFromClient(row.comments[0]?.author?.role ?? null)).map((row) => row.id);
}

export async function buildQueueContext(viewerId: string, now = new Date()): Promise<QueueContext> {
  return { viewerId, now, needsReplyIds: await findNeedsReplyIds(viewerId) };
}

function andWhere(parts: Prisma.IssueTicketWhereInput[]): Prisma.IssueTicketWhereInput {
  return parts.length === 0 ? {} : { AND: parts };
}

export type CaseSummaryQuery = {
  queue: CaseQueue;
  filters: CaseFilterInput;
  sort: CaseSort;
  dir: "asc" | "desc";
  skip: number;
  take: number;
};

export async function listCaseSummaries(query: CaseSummaryQuery, context: QueueContext): Promise<{ rows: CaseSummary[]; total: number }> {
  await ensureLegacyDisputesMigrated();
  const where = andWhere([buildQueueWhere(query.queue, context), ...buildCaseFilterWhere(query.filters)]);
  const keys: CaseSortKey[] = await db.issueTicket.findMany({
    where,
    select: { id: true, status: true, severity: true, caseType: true, slaBreachAt: true, createdAt: true, updatedAt: true },
  });
  const ordered = [...keys].sort(compareCases(query.sort, query.dir));
  const pageIds = ordered.slice(query.skip, query.skip + query.take).map((row) => row.id);
  if (pageIds.length === 0) return { rows: [], total: keys.length };
  const rows = await db.issueTicket.findMany({ where: { id: { in: pageIds } }, include: summaryInclude });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    rows: pageIds.map((id) => byId.get(id)).filter((row): row is SummaryRow => Boolean(row)).map(toCaseSummary),
    total: keys.length,
  };
}

/** One case as a summary (after a mutation), or null when it no longer exists. */
export async function getCaseSummary(id: string): Promise<CaseSummary | null> {
  const row = await db.issueTicket.findUnique({ where: { id }, include: summaryInclude });
  return row ? toCaseSummary(row) : null;
}

/**
 * Queue counts honour every filter except the queue; type counts honour every
 * filter (queue included) except the type.
 */
export async function countCaseQueues(
  queue: CaseQueue,
  filters: CaseFilterInput,
  context: QueueContext,
): Promise<{ counts: CaseQueueCounts; typeCounts: CaseTypeCounts }> {
  const filterParts = buildCaseFilterWhere(filters);
  const queueTotals = await Promise.all(
    CASE_QUEUES.map((key) => db.issueTicket.count({ where: andWhere([buildQueueWhere(key, context), ...filterParts]) })),
  );
  const counts = Object.fromEntries(CASE_QUEUES.map((key, index) => [key, queueTotals[index]])) as CaseQueueCounts;

  const withoutType = buildCaseFilterWhere({ ...filters, caseType: null });
  const grouped = await db.issueTicket.groupBy({
    by: ["caseType"],
    where: andWhere([buildQueueWhere(queue, context), ...withoutType]),
    _count: { _all: true },
  });
  const typeCounts = Object.fromEntries(CASE_TYPES.map((type) => [type, 0])) as CaseTypeCounts;
  for (const group of grouped) {
    const raw = String(group.caseType ?? "").toUpperCase();
    const key: CaseTypeKey = (CASE_TYPES as readonly string[]).includes(raw) ? (raw as CaseTypeKey) : "OTHER";
    typeCounts[key] += group._count._all;
  }
  return { counts, typeCounts };
}
