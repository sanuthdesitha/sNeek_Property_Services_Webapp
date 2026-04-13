import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { parseCaseDescription } from "@/lib/issues/case-utils";
import { readSettingStore, writeSettingStore } from "@/lib/phase4/store";
import { publicUrl } from "@/lib/s3";
import { listDisputes, type DisputeRecord } from "@/lib/phase4/disputes";
import { normalizeUnifiedCaseStatus, type UnifiedCaseStatus } from "@/lib/cases/status";

const LEGACY_MIGRATION_KEY = "cases_legacy_disputes_migration_v1";

type LegacyMigrationState = {
  migratedIds: string[];
};

const DEFAULT_MIGRATION_STATE: LegacyMigrationState = {
  migratedIds: [],
};

function sanitizeMigrationState(input: unknown): LegacyMigrationState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return DEFAULT_MIGRATION_STATE;
  }
  const row = input as Record<string, unknown>;
  const migratedIds = Array.isArray(row.migratedIds)
    ? row.migratedIds
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  return { migratedIds: Array.from(new Set(migratedIds)) };
}

export type CaseType = "DAMAGE" | "CLIENT_DISPUTE" | "LOST_FOUND" | "OPS" | "SLA" | "OTHER";
export type CaseStatus = UnifiedCaseStatus;

export interface CaseListFilters {
  status?: string | null;
  caseType?: string | null;
  clientId?: string | null;
  propertyId?: string | null;
  jobId?: string | null;
  q?: string | null;
  clientVisibleOnly?: boolean;
  assigneeUserId?: string | null;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeCaseType(value: string | null | undefined): CaseType {
  switch (String(value ?? "").trim().toUpperCase()) {
    case "DAMAGE":
      return "DAMAGE";
    case "CLIENT_DISPUTE":
      return "CLIENT_DISPUTE";
    case "LOST_FOUND":
      return "LOST_FOUND";
    case "OPS":
      return "OPS";
    case "SLA":
      return "SLA";
    default:
      return "OTHER";
  }
}

function normalizeCaseStatus(value: string | null | undefined): CaseStatus {
  return normalizeUnifiedCaseStatus(value);
}

function normalizeSeverity(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "LOW" || normalized === "HIGH" || normalized === "CRITICAL") return normalized;
  return "MEDIUM";
}

function extractLegacyMetadata(issue: {
  description: string | null;
  metadata: Prisma.JsonValue | null;
  assignedToUserId: string | null;
}) {
  const parsed = parseCaseDescription(issue.description);
  const dbMeta =
    issue.metadata && typeof issue.metadata === "object" && !Array.isArray(issue.metadata)
      ? (issue.metadata as Record<string, unknown>)
      : {};
  const tags = Array.isArray(dbMeta.tags)
    ? dbMeta.tags.filter((tag): tag is string => typeof tag === "string")
    : parsed.metadata.tags ?? [];
  const dueAt =
    typeof dbMeta.dueAt === "string" && dbMeta.dueAt.trim()
      ? dbMeta.dueAt.trim()
      : parsed.metadata.dueAt ?? null;
  const originalStatus =
    typeof dbMeta.originalStatus === "string" && dbMeta.originalStatus.trim()
      ? dbMeta.originalStatus.trim()
      : null;

  return {
    plainDescription: parsed.text || issue.description || "",
    evidenceKeys: parsed.evidenceKeys,
    tags,
    dueAt,
    originalStatus,
    assigneeUserId:
      issue.assignedToUserId || parsed.metadata.assigneeUserId || (typeof dbMeta.assigneeUserId === "string" ? dbMeta.assigneeUserId : null),
    legacyMetadata: dbMeta,
  };
}

function serializeCase(issue: any) {
  const meta = extractLegacyMetadata(issue);
  return {
    id: issue.id,
    jobId: issue.jobId ?? null,
    clientId: issue.clientId ?? null,
    propertyId: issue.propertyId ?? null,
    reportId: issue.reportId ?? null,
    title: issue.title,
    description: meta.plainDescription,
    severity: normalizeSeverity(issue.severity),
    priority: normalizeSeverity(issue.severity),
    status: normalizeCaseStatus(issue.status),
    caseType: normalizeCaseType(issue.caseType || issue.source || issue.title),
    source: issue.source ?? null,
    clientVisible: issue.clientVisible === true,
    clientCanReply: issue.clientCanReply !== false,
    resolutionNote: issue.resolutionNote ?? null,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    resolvedAt: normalizeCaseStatus(issue.status) === "RESOLVED" ? issue.updatedAt : null,
    tags: meta.tags,
    dueAt: meta.dueAt,
    originalStatus: meta.originalStatus,
    metadata: meta.legacyMetadata,
    evidenceKeys: meta.evidenceKeys,
    job: issue.job ?? null,
    client: issue.client ?? null,
    property: issue.property ?? issue.job?.property ?? null,
    report: issue.report ?? null,
    assignedTo: issue.assignedTo ?? null,
    comments: Array.isArray(issue.comments)
      ? issue.comments.map((comment: any) => ({
          id: comment.id,
          body: comment.body,
          isInternal: comment.isInternal === true,
          createdAt: comment.createdAt,
          author: comment.author ?? null,
        }))
      : [],
    attachments: Array.isArray(issue.attachments)
      ? issue.attachments.map((attachment: any) => ({
          id: attachment.id,
          s3Key: attachment.s3Key,
          url: attachment.url,
          mimeType: attachment.mimeType,
          label: attachment.label,
          createdAt: attachment.createdAt,
          uploadedBy: attachment.uploadedBy ?? null,
        }))
      : [],
  };
}

export function toClientCaseView<T extends ReturnType<typeof serializeCase>>(issue: T) {
  return {
    ...issue,
    comments: Array.isArray(issue.comments)
      ? issue.comments.filter((comment) => comment.isInternal !== true)
      : [],
  };
}

function mapLegacyDisputeStatus(value: DisputeRecord["status"]): CaseStatus {
  if (value === "UNDER_REVIEW") return "INVESTIGATING";
  if (value === "RESOLVED" || value === "REJECTED") return "RESOLVED";
  return "OPEN";
}

async function migrateLegacyDispute(row: DisputeRecord) {
  const created = await db.issueTicket.create({
    data: {
      jobId: row.jobId ?? undefined,
      clientId: row.clientId ?? undefined,
      propertyId: row.propertyId ?? undefined,
      reportId: row.reportId ?? undefined,
      title: row.title,
      description: row.description,
      caseType: "CLIENT_DISPUTE",
      source: "LEGACY_DISPUTE",
      severity: normalizeSeverity(row.priority),
      status: mapLegacyDisputeStatus(row.status),
      clientVisible: true,
      clientCanReply: true,
      resolutionNote: row.resolutionNote ?? undefined,
      metadata: {
        externalId: row.id,
        invoiceRef: row.invoiceRef,
        amountDisputed: row.amountDisputed,
        currency: row.currency,
        originalStatus: row.status,
      } as any,
      comments: row.comments.length
        ? {
            create: row.comments.map((comment) => ({
              authorUserId: comment.authorUserId,
              body: comment.body,
              isInternal: false,
              createdAt: new Date(comment.createdAt),
            })),
          }
        : undefined,
    },
  });
  return created.id;
}

export async function ensureLegacyDisputesMigrated() {
  const [migrationState, legacyRows] = await Promise.all([
    readSettingStore(LEGACY_MIGRATION_KEY, DEFAULT_MIGRATION_STATE, (input) =>
      sanitizeMigrationState(input)
    ),
    listDisputes(),
  ]);

  const migratedIds = new Set(migrationState.data.migratedIds);
  const pending = legacyRows.filter((row) => !migratedIds.has(row.id));
  if (pending.length === 0) return;

  for (const row of pending) {
    await migrateLegacyDispute(row);
    migratedIds.add(row.id);
  }

  await writeSettingStore(LEGACY_MIGRATION_KEY, {
    version: migrationState.version + 1,
    data: { migratedIds: Array.from(migratedIds) },
  });
}

export async function listCases(filters: CaseListFilters = {}) {
  await ensureLegacyDisputesMigrated();

  const where: Prisma.IssueTicketWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.caseType) where.caseType = filters.caseType;
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.propertyId) where.propertyId = filters.propertyId;
  if (filters.jobId) where.jobId = filters.jobId;
  if (filters.clientVisibleOnly) where.clientVisible = true;
  if (filters.assigneeUserId === "__unassigned") {
    where.assignedToUserId = null;
  } else if (filters.assigneeUserId) {
    where.assignedToUserId = filters.assigneeUserId;
  }
  if (filters.q?.trim()) {
    where.OR = [
      { title: { contains: filters.q.trim(), mode: "insensitive" } },
      { description: { contains: filters.q.trim(), mode: "insensitive" } },
      { resolutionNote: { contains: filters.q.trim(), mode: "insensitive" } },
      { job: { jobNumber: { contains: filters.q.trim(), mode: "insensitive" } } },
      { property: { name: { contains: filters.q.trim(), mode: "insensitive" } } },
      { client: { name: { contains: filters.q.trim(), mode: "insensitive" } } },
    ];
  }

  const rows = await db.issueTicket.findMany({
    where,
    include: {
      job: {
        select: {
          id: true,
          jobNumber: true,
          status: true,
          scheduledDate: true,
          property: {
            select: { id: true, name: true, suburb: true },
          },
        },
      },
      client: { select: { id: true, name: true, email: true } },
      property: { select: { id: true, name: true, suburb: true } },
      report: { select: { id: true, jobId: true } },
      assignedTo: { select: { id: true, name: true, email: true, role: true } },
      comments: {
        include: {
          author: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      attachments: {
        include: {
          uploadedBy: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });

  return rows.map(serializeCase);
}

export async function getCaseById(id: string) {
  await ensureLegacyDisputesMigrated();
  const row = await db.issueTicket.findUnique({
    where: { id },
    include: {
      job: {
        select: {
          id: true,
          jobNumber: true,
          status: true,
          scheduledDate: true,
          property: { select: { id: true, name: true, suburb: true } },
        },
      },
      client: { select: { id: true, name: true, email: true } },
      property: { select: { id: true, name: true, suburb: true } },
      report: { select: { id: true, jobId: true } },
      assignedTo: { select: { id: true, name: true, email: true, role: true } },
      comments: {
        include: { author: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: "asc" },
      },
      attachments: {
        include: { uploadedBy: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return row ? serializeCase(row) : null;
}

export async function createCase(input: {
  title: string;
  description?: string | null;
  severity?: string | null;
  status?: string | null;
  caseType?: string | null;
  source?: string | null;
  jobId?: string | null;
  clientId?: string | null;
  propertyId?: string | null;
  reportId?: string | null;
  assignedToUserId?: string | null;
  clientVisible?: boolean;
  clientCanReply?: boolean;
  resolutionNote?: string | null;
  metadata?: Record<string, unknown>;
  comment?: { authorUserId: string; body: string; isInternal?: boolean } | null;
  attachments?: Array<{
    uploadedByUserId: string;
    s3Key: string;
    url?: string | null;
    mimeType?: string | null;
    label?: string | null;
  }>;
}) {
  const created = await db.issueTicket.create({
    data: {
      title: input.title.trim().slice(0, 180),
      description: input.description?.trim() || null,
      severity: normalizeSeverity(input.severity),
      status: normalizeCaseStatus(input.status),
      caseType: normalizeCaseType(input.caseType),
      source: input.source?.trim() || undefined,
      jobId: input.jobId?.trim() || undefined,
      clientId: input.clientId?.trim() || undefined,
      propertyId: input.propertyId?.trim() || undefined,
      reportId: input.reportId?.trim() || undefined,
      assignedToUserId: input.assignedToUserId?.trim() || undefined,
      clientVisible: input.clientVisible === true,
      clientCanReply: input.clientCanReply !== false,
      resolutionNote: input.resolutionNote?.trim() || undefined,
      metadata: (input.metadata ?? {}) as any,
      comments: input.comment
        ? {
            create: {
              authorUserId: input.comment.authorUserId,
              body: input.comment.body.trim(),
              isInternal: input.comment.isInternal === true,
            },
          }
        : undefined,
      attachments:
        input.attachments && input.attachments.length > 0
          ? {
              create: input.attachments.map((attachment) => ({
                uploadedByUserId: attachment.uploadedByUserId,
                s3Key: attachment.s3Key,
                url: attachment.url?.trim() || publicUrl(attachment.s3Key),
                mimeType: attachment.mimeType?.trim() || undefined,
                label: attachment.label?.trim() || undefined,
              })),
            }
          : undefined,
    },
  });

  return getCaseById(created.id);
}

export async function updateCase(id: string, patch: {
  title?: string;
  description?: string | null;
  severity?: string | null;
  status?: string | null;
  assignedToUserId?: string | null;
  clientVisible?: boolean;
  clientCanReply?: boolean;
  resolutionNote?: string | null;
  caseType?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const existing = await db.issueTicket.findUnique({
    where: { id },
    select: { id: true, metadata: true, resolutionNote: true, description: true },
  });
  if (!existing) return null;
  const nextMetadata = {
    ...(existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
      ? (existing.metadata as Record<string, unknown>)
      : {}),
    ...(patch.metadata ?? {}),
  };

  await db.issueTicket.update({
    where: { id },
    data: {
      title: patch.title?.trim().slice(0, 180) || undefined,
      description: patch.description !== undefined ? patch.description?.trim() || null : undefined,
      severity: patch.severity ? normalizeSeverity(patch.severity) : undefined,
      status: patch.status ? normalizeCaseStatus(patch.status) : undefined,
      assignedToUserId:
        patch.assignedToUserId !== undefined ? patch.assignedToUserId?.trim() || null : undefined,
      clientVisible: patch.clientVisible,
      clientCanReply: patch.clientCanReply,
      resolutionNote:
        patch.resolutionNote !== undefined ? patch.resolutionNote?.trim() || null : undefined,
      caseType: patch.caseType ? normalizeCaseType(patch.caseType) : undefined,
      metadata: nextMetadata as any,
    },
  });

  return getCaseById(id);
}

export async function addCaseComment(input: {
  caseId: string;
  authorUserId: string;
  body: string;
  isInternal?: boolean;
}) {
  await db.caseComment.create({
    data: {
      caseId: input.caseId,
      authorUserId: input.authorUserId,
      body: input.body.trim().slice(0, 4000),
      isInternal: input.isInternal === true,
    },
  });
  return getCaseById(input.caseId);
}

export async function addCaseAttachment(input: {
  caseId: string;
  uploadedByUserId: string;
  s3Key: string;
  url?: string | null;
  mimeType?: string | null;
  label?: string | null;
}) {
  await db.caseAttachment.create({
    data: {
      caseId: input.caseId,
      uploadedByUserId: input.uploadedByUserId,
      s3Key: input.s3Key,
      url: input.url?.trim() || publicUrl(input.s3Key),
      mimeType: input.mimeType?.trim() || undefined,
      label: input.label?.trim() || undefined,
    },
  });
  return getCaseById(input.caseId);
}

export async function listCaseAssignees() {
  return db.user.findMany({
    where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
}

export async function deleteCase(id: string) {
  const existing = await db.issueTicket.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await db.issueTicket.delete({ where: { id } });
  return true;
}
