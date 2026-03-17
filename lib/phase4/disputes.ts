import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { readSettingStore, writeSettingStore } from "@/lib/phase4/store";

const DISPUTES_KEY = "phase4_disputes_v1";

export type DisputeStatus = "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "REJECTED";
export type DisputePriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface DisputeComment {
  id: string;
  authorUserId: string;
  body: string;
  createdAt: string;
}

export interface DisputeRecord {
  id: string;
  clientId: string | null;
  propertyId: string | null;
  jobId: string | null;
  reportId: string | null;
  invoiceRef: string | null;
  title: string;
  description: string;
  amountDisputed: number | null;
  currency: string;
  status: DisputeStatus;
  priority: DisputePriority;
  raisedByUserId: string;
  assignedToUserId: string | null;
  resolutionNote: string | null;
  comments: DisputeComment[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

interface DisputeStore {
  disputes: DisputeRecord[];
}

const DEFAULT_STORE: DisputeStore = { disputes: [] };

function sanitizeComment(value: unknown): DisputeComment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const authorUserId = String(row.authorUserId ?? "").trim();
  const body = String(row.body ?? "").trim().slice(0, 2000);
  if (!id || !authorUserId || !body) return null;
  return {
    id,
    authorUserId,
    body,
    createdAt: String(row.createdAt ?? new Date().toISOString()),
  };
}

function sanitizeDispute(value: unknown): DisputeRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const title = String(row.title ?? "").trim().slice(0, 180);
  const raisedByUserId = String(row.raisedByUserId ?? "").trim();
  if (!id || !title || !raisedByUserId) return null;
  const comments = Array.isArray(row.comments)
    ? row.comments.map(sanitizeComment).filter((item): item is DisputeComment => Boolean(item))
    : [];
  return {
    id,
    clientId: row.clientId ? String(row.clientId).trim() : null,
    propertyId: row.propertyId ? String(row.propertyId).trim() : null,
    jobId: row.jobId ? String(row.jobId).trim() : null,
    reportId: row.reportId ? String(row.reportId).trim() : null,
    invoiceRef: row.invoiceRef ? String(row.invoiceRef).trim().slice(0, 120) : null,
    title,
    description: String(row.description ?? "").trim().slice(0, 6000),
    amountDisputed:
      row.amountDisputed === null || row.amountDisputed === undefined
        ? null
        : Math.max(0, Number(row.amountDisputed ?? 0)),
    currency: String(row.currency ?? "AUD")
      .trim()
      .toUpperCase()
      .slice(0, 8) || "AUD",
    status:
      row.status === "UNDER_REVIEW" ||
      row.status === "RESOLVED" ||
      row.status === "REJECTED"
        ? row.status
        : "OPEN",
    priority:
      row.priority === "LOW" ||
      row.priority === "HIGH" ||
      row.priority === "CRITICAL"
        ? row.priority
        : "MEDIUM",
    raisedByUserId,
    assignedToUserId: row.assignedToUserId ? String(row.assignedToUserId).trim() : null,
    resolutionNote: row.resolutionNote ? String(row.resolutionNote).trim().slice(0, 4000) : null,
    comments,
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? new Date().toISOString()),
    resolvedAt: row.resolvedAt ? String(row.resolvedAt) : null,
  };
}

function sanitizeStore(value: unknown, fallback: DisputeStore): DisputeStore {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const row = value as Record<string, unknown>;
  const disputes = Array.isArray(row.disputes)
    ? row.disputes.map(sanitizeDispute).filter((item): item is DisputeRecord => Boolean(item))
    : [];
  return { disputes };
}

async function readStore() {
  return readSettingStore(DISPUTES_KEY, DEFAULT_STORE, sanitizeStore);
}

async function writeStore(version: number, data: DisputeStore) {
  return writeSettingStore(DISPUTES_KEY, { version, data });
}

export async function listDisputes(input?: {
  clientId?: string | null;
  status?: DisputeStatus | null;
}) {
  const store = await readStore();
  return store.data.disputes
    .filter((item) => {
      if (input?.clientId && item.clientId !== input.clientId) return false;
      if (input?.status && item.status !== input.status) return false;
      return true;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDisputeById(id: string) {
  const rows = await listDisputes();
  return rows.find((row) => row.id === id) ?? null;
}

export async function createDispute(input: {
  clientId?: string | null;
  propertyId?: string | null;
  jobId?: string | null;
  reportId?: string | null;
  invoiceRef?: string | null;
  title: string;
  description: string;
  amountDisputed?: number | null;
  currency?: string;
  priority?: DisputePriority;
  raisedByUserId: string;
}) {
  const store = await readStore();
  const now = new Date().toISOString();
  const row: DisputeRecord = {
    id: randomUUID(),
    clientId: input.clientId?.trim() || null,
    propertyId: input.propertyId?.trim() || null,
    jobId: input.jobId?.trim() || null,
    reportId: input.reportId?.trim() || null,
    invoiceRef: input.invoiceRef?.trim().slice(0, 120) || null,
    title: input.title.trim().slice(0, 180) || "Dispute",
    description: input.description.trim().slice(0, 6000),
    amountDisputed:
      input.amountDisputed === null || input.amountDisputed === undefined
        ? null
        : Math.max(0, Number(input.amountDisputed || 0)),
    currency: (input.currency?.trim().toUpperCase() || "AUD").slice(0, 8),
    status: "OPEN",
    priority: input.priority ?? "MEDIUM",
    raisedByUserId: input.raisedByUserId,
    assignedToUserId: null,
    resolutionNote: null,
    comments: [],
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
  };
  const disputes = [row, ...store.data.disputes].slice(0, 1000);
  await writeStore(store.version + 1, { disputes });
  return row;
}

export async function patchDispute(
  id: string,
  patch: {
    status?: DisputeStatus;
    priority?: DisputePriority;
    assignedToUserId?: string | null;
    resolutionNote?: string | null;
    addComment?: { authorUserId: string; body: string } | null;
  }
) {
  const store = await readStore();
  const index = store.data.disputes.findIndex((row) => row.id === id);
  if (index < 0) return null;
  const current = store.data.disputes[index];
  const nextStatus = patch.status ?? current.status;
  const now = new Date().toISOString();
  const nextComments = [...current.comments];
  if (patch.addComment?.body?.trim()) {
    nextComments.push({
      id: randomUUID(),
      authorUserId: patch.addComment.authorUserId,
      body: patch.addComment.body.trim().slice(0, 2000),
      createdAt: now,
    });
  }
  const next: DisputeRecord = {
    ...current,
    status: nextStatus,
    priority: patch.priority ?? current.priority,
    assignedToUserId:
      patch.assignedToUserId !== undefined
        ? patch.assignedToUserId?.trim() || null
        : current.assignedToUserId,
    resolutionNote:
      patch.resolutionNote !== undefined
        ? patch.resolutionNote?.trim().slice(0, 4000) || null
        : current.resolutionNote,
    comments: nextComments,
    updatedAt: now,
    resolvedAt: nextStatus === "RESOLVED" || nextStatus === "REJECTED" ? now : current.resolvedAt,
  };
  const disputes = [...store.data.disputes];
  disputes[index] = next;
  await writeStore(store.version + 1, { disputes });
  return next;
}

export async function deleteDispute(id: string) {
  const store = await readStore();
  const next = store.data.disputes.filter((row) => row.id !== id);
  if (next.length === store.data.disputes.length) return false;
  await writeStore(store.version + 1, { disputes: next });
  return true;
}

export async function enrichDisputes(rows: DisputeRecord[]) {
  const clientIds = Array.from(new Set(rows.map((row) => row.clientId).filter(Boolean))) as string[];
  const propertyIds = Array.from(new Set(rows.map((row) => row.propertyId).filter(Boolean))) as string[];
  const jobIds = Array.from(new Set(rows.map((row) => row.jobId).filter(Boolean))) as string[];
  const userIds = Array.from(
    new Set(
      rows.flatMap((row) => [
        row.raisedByUserId,
        row.assignedToUserId,
        ...row.comments.map((comment) => comment.authorUserId),
      ])
    )
  ).filter(Boolean) as string[];

  const [clients, properties, jobs, users] = await Promise.all([
    clientIds.length
      ? db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    propertyIds.length
      ? db.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    jobIds.length
      ? db.job.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, jobType: true, scheduledDate: true, property: { select: { name: true } } },
        })
      : Promise.resolve([]),
    userIds.length
      ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
      : Promise.resolve([]),
  ]);

  const clientById = new Map(clients.map((row) => [row.id, row]));
  const propertyById = new Map(properties.map((row) => [row.id, row]));
  const jobById = new Map(jobs.map((row) => [row.id, row]));
  const userById = new Map(users.map((row) => [row.id, row]));

  return rows.map((row) => ({
    ...row,
    client: row.clientId ? clientById.get(row.clientId) ?? null : null,
    property: row.propertyId ? propertyById.get(row.propertyId) ?? null : null,
    job: row.jobId ? jobById.get(row.jobId) ?? null : null,
    raisedBy: userById.get(row.raisedByUserId) ?? null,
    assignedTo: row.assignedToUserId ? userById.get(row.assignedToUserId) ?? null : null,
    comments: row.comments.map((comment) => ({
      ...comment,
      author: userById.get(comment.authorUserId) ?? null,
    })),
  }));
}
