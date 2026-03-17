import { randomUUID } from "crypto";
import { db } from "@/lib/db";

const CLIENT_APPROVALS_KEY = "client_approvals_v1";

export type ClientApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "DECLINED"
  | "CANCELLED"
  | "EXPIRED";

export interface ClientApprovalRecord {
  id: string;
  clientId: string;
  propertyId: string | null;
  jobId: string | null;
  quoteId: string | null;
  title: string;
  description: string;
  amount: number;
  currency: string;
  status: ClientApprovalStatus;
  requestedByUserId: string;
  requestedAt: string;
  expiresAt: string | null;
  respondedByUserId: string | null;
  respondedAt: string | null;
  responseNote: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface StoredData {
  approvals: ClientApprovalRecord[];
}

type CreateInput = {
  clientId: string;
  propertyId?: string | null;
  jobId?: string | null;
  quoteId?: string | null;
  title: string;
  description: string;
  amount: number;
  currency?: string;
  requestedByUserId: string;
  expiresAt?: string | null;
  metadata?: Record<string, unknown> | null;
};

type UpdateInput = {
  title?: string;
  description?: string;
  amount?: number;
  currency?: string;
  status?: ClientApprovalStatus;
  propertyId?: string | null;
  jobId?: string | null;
  quoteId?: string | null;
  expiresAt?: string | null;
  responseNote?: string | null;
  metadata?: Record<string, unknown> | null;
};

type RespondInput = {
  id: string;
  clientId: string;
  decision: "APPROVE" | "DECLINE";
  respondedByUserId: string;
  responseNote?: string | null;
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeStatus(value: unknown): ClientApprovalStatus {
  return value === "APPROVED" ||
    value === "DECLINED" ||
    value === "CANCELLED" ||
    value === "EXPIRED"
    ? value
    : "PENDING";
}

function sanitizeText(value: unknown, max: number, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, max);
}

function sanitizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function sanitizeRecord(value: unknown): ClientApprovalRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = sanitizeText(row.id, 100);
  const clientId = sanitizeText(row.clientId, 100);
  const requestedByUserId = sanitizeText(row.requestedByUserId, 100);
  if (!id || !clientId || !requestedByUserId) return null;

  const nowIso = new Date().toISOString();
  const title = sanitizeText(row.title, 160, "Client Approval");
  const description = sanitizeText(row.description, 6000);
  const amount = Math.max(0, toNumber(row.amount, 0));
  const currency = sanitizeText(row.currency, 8, "AUD").toUpperCase() || "AUD";
  const status = sanitizeStatus(row.status);
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;

  return {
    id,
    clientId,
    propertyId: row.propertyId == null ? null : sanitizeText(row.propertyId, 100) || null,
    jobId: row.jobId == null ? null : sanitizeText(row.jobId, 100) || null,
    quoteId: row.quoteId == null ? null : sanitizeText(row.quoteId, 100) || null,
    title,
    description,
    amount,
    currency,
    status,
    requestedByUserId,
    requestedAt: sanitizeIsoDate(row.requestedAt) ?? nowIso,
    expiresAt: sanitizeIsoDate(row.expiresAt),
    respondedByUserId:
      row.respondedByUserId == null ? null : sanitizeText(row.respondedByUserId, 100) || null,
    respondedAt: sanitizeIsoDate(row.respondedAt),
    responseNote: row.responseNote == null ? null : sanitizeText(row.responseNote, 2000) || null,
    metadata,
    createdAt: sanitizeIsoDate(row.createdAt) ?? nowIso,
    updatedAt: sanitizeIsoDate(row.updatedAt) ?? nowIso,
  };
}

async function readStore(): Promise<StoredData> {
  const row = await db.appSetting.findUnique({ where: { key: CLIENT_APPROVALS_KEY } });
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { approvals: [] };
  const approvals = Array.isArray((value as any).approvals)
    ? ((value as any).approvals as unknown[])
        .map(sanitizeRecord)
        .filter((item): item is ClientApprovalRecord => Boolean(item))
    : [];
  return { approvals };
}

async function writeStore(data: StoredData) {
  await db.appSetting.upsert({
    where: { key: CLIENT_APPROVALS_KEY },
    create: { key: CLIENT_APPROVALS_KEY, value: { approvals: data.approvals } as any },
    update: { value: { approvals: data.approvals } as any },
  });
}

function withDerivedStatus(record: ClientApprovalRecord): ClientApprovalRecord {
  if (record.status !== "PENDING" || !record.expiresAt) return record;
  const expiresAt = new Date(record.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) return record;
  if (expiresAt.getTime() >= Date.now()) return record;
  return { ...record, status: "EXPIRED" };
}

export async function listClientApprovals(input?: {
  clientId?: string;
  status?: ClientApprovalStatus;
}) {
  const store = await readStore();
  return store.approvals
    .map(withDerivedStatus)
    .filter((approval) => {
      if (input?.clientId && approval.clientId !== input.clientId) return false;
      if (input?.status && approval.status !== input.status) return false;
      return true;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getClientApprovalById(id: string) {
  const approvals = await listClientApprovals();
  return approvals.find((approval) => approval.id === id) ?? null;
}

export async function createClientApproval(input: CreateInput) {
  const store = await readStore();
  const now = new Date().toISOString();
  const created: ClientApprovalRecord = {
    id: randomUUID(),
    clientId: input.clientId.trim(),
    propertyId: input.propertyId?.trim() || null,
    jobId: input.jobId?.trim() || null,
    quoteId: input.quoteId?.trim() || null,
    title: input.title.trim().slice(0, 160) || "Client Approval",
    description: input.description.trim().slice(0, 6000),
    amount: Math.max(0, Number(input.amount || 0)),
    currency: (input.currency?.trim().toUpperCase() || "AUD").slice(0, 8),
    status: "PENDING",
    requestedByUserId: input.requestedByUserId.trim(),
    requestedAt: now,
    expiresAt: sanitizeIsoDate(input.expiresAt ?? null),
    respondedByUserId: null,
    respondedAt: null,
    responseNote: null,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : null,
    createdAt: now,
    updatedAt: now,
  };
  store.approvals.unshift(created);
  if (store.approvals.length > 1000) {
    store.approvals = store.approvals.slice(0, 1000);
  }
  await writeStore(store);
  return created;
}

export async function updateClientApprovalById(id: string, patch: UpdateInput) {
  const store = await readStore();
  const index = store.approvals.findIndex((approval) => approval.id === id);
  if (index === -1) return null;
  const existing = withDerivedStatus(store.approvals[index]);
  const updated: ClientApprovalRecord = {
    ...existing,
    title:
      patch.title !== undefined
        ? patch.title.trim().slice(0, 160) || existing.title
        : existing.title,
    description:
      patch.description !== undefined
        ? patch.description.trim().slice(0, 6000)
        : existing.description,
    amount:
      patch.amount !== undefined ? Math.max(0, Number(patch.amount || 0)) : existing.amount,
    currency:
      patch.currency !== undefined
        ? (patch.currency.trim().toUpperCase().slice(0, 8) || existing.currency)
        : existing.currency,
    status: patch.status ?? existing.status,
    propertyId: patch.propertyId !== undefined ? patch.propertyId?.trim() || null : existing.propertyId,
    jobId: patch.jobId !== undefined ? patch.jobId?.trim() || null : existing.jobId,
    quoteId: patch.quoteId !== undefined ? patch.quoteId?.trim() || null : existing.quoteId,
    expiresAt:
      patch.expiresAt !== undefined
        ? sanitizeIsoDate(patch.expiresAt)
        : existing.expiresAt,
    responseNote:
      patch.responseNote !== undefined
        ? patch.responseNote?.trim().slice(0, 2000) || null
        : existing.responseNote,
    metadata:
      patch.metadata !== undefined
        ? patch.metadata && typeof patch.metadata === "object"
          ? patch.metadata
          : null
        : existing.metadata,
    updatedAt: new Date().toISOString(),
  };
  store.approvals[index] = updated;
  await writeStore(store);
  return updated;
}

export async function respondClientApproval(input: RespondInput) {
  const store = await readStore();
  const index = store.approvals.findIndex((approval) => approval.id === input.id);
  if (index === -1) return null;
  const existing = withDerivedStatus(store.approvals[index]);
  if (existing.clientId !== input.clientId) throw new Error("FORBIDDEN");
  if (existing.status !== "PENDING") throw new Error("INVALID_STATE");

  const now = new Date().toISOString();
  const updated: ClientApprovalRecord = {
    ...existing,
    status: input.decision === "APPROVE" ? "APPROVED" : "DECLINED",
    respondedByUserId: input.respondedByUserId.trim(),
    respondedAt: now,
    responseNote: input.responseNote?.trim().slice(0, 2000) || null,
    updatedAt: now,
  };
  store.approvals[index] = updated;
  await writeStore(store);
  return updated;
}

export async function deleteClientApprovalById(id: string) {
  const store = await readStore();
  const before = store.approvals.length;
  store.approvals = store.approvals.filter((approval) => approval.id !== id);
  if (store.approvals.length === before) return false;
  await writeStore(store);
  return true;
}
