import { randomUUID } from "crypto";
import { db } from "@/lib/db";

const CLIENT_APPROVALS_KEY = "client_approvals_v1";

export type ClientApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "DECLINED"
  | "CANCELLED"
  | "EXPIRED"
  /**
   * CP-3b — the client neither accepted nor refused: they proposed different
   * terms and handed it back. A countered approval is still LIVE work for
   * admin, so it deliberately stays out of the terminal statuses and keeps
   * appearing in the admin queue until somebody settles it.
   */
  | "COUNTERED";

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
  /** CP-3b — the amount the CLIENT proposed instead, when they countered. */
  counterAmount: number | null;
  counterNote: string | null;
  counterAt: string | null;
  counterByUserId: string | null;
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
    value === "EXPIRED" ||
    value === "COUNTERED"
    ? value
    : "PENDING";
}

function sanitizeAmount(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
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
    counterAmount: sanitizeAmount(row.counterAmount),
    counterNote: row.counterNote == null ? null : sanitizeText(row.counterNote, 2000) || null,
    counterAt: sanitizeIsoDate(row.counterAt),
    counterByUserId:
      row.counterByUserId == null ? null : sanitizeText(row.counterByUserId, 100) || null,
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
    counterAmount: null,
    counterNote: null,
    counterAt: null,
    counterByUserId: null,
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
    // CP-3b — moving OFF a counter settles it, so the proposal must not linger.
    // A stale counterAmount beside a new agreed amount is how the two sides end
    // up arguing about different numbers. Cleared on every exit path (approve,
    // decline, reopen) rather than only the one the UI happens to use.
    ...(patch.status && patch.status !== "COUNTERED" && existing.status === "COUNTERED"
      ? { counterAmount: null, counterNote: null, counterAt: null, counterByUserId: null }
      : {}),
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

/**
 * CP-3b — the client hands it back with different terms instead of a yes/no.
 *
 * The request's own amount is left ALONE: overwriting it would destroy what
 * admin actually asked for, and the two numbers side by side are the whole
 * point of a counter-offer. The proposal lives in `counterAmount`/`counterNote`
 * until an admin settles it.
 *
 * Only a PENDING request may be countered — the same rule `respondClientApproval`
 * enforces — so a client cannot reopen something already decided, and cannot
 * counter twice in a row without admin coming back to them.
 */
export async function counterClientApproval(input: {
  id: string;
  clientId: string;
  amount: number;
  note?: string | null;
  counteredByUserId: string;
}) {
  const store = await readStore();
  const index = store.approvals.findIndex((approval) => approval.id === input.id);
  if (index === -1) return null;
  const existing = withDerivedStatus(store.approvals[index]);
  if (existing.clientId !== input.clientId) throw new Error("FORBIDDEN");
  if (existing.status !== "PENDING") throw new Error("INVALID_STATE");

  const amount = sanitizeAmount(input.amount);
  if (amount === null) throw new Error("INVALID_AMOUNT");

  const now = new Date().toISOString();
  const updated: ClientApprovalRecord = {
    ...existing,
    status: "COUNTERED",
    counterAmount: amount,
    counterNote: input.note?.trim().slice(0, 2000) || null,
    counterAt: now,
    counterByUserId: input.counteredByUserId.trim(),
    updatedAt: now,
  };
  store.approvals[index] = updated;
  await writeStore(store);
  return updated;
}

/**
 * Admin's answer to a counter-offer: put the request back in front of the
 * client at a (possibly new) price. Clearing the counter fields is deliberate —
 * leaving a stale proposal attached to a re-opened request is how the two sides
 * end up arguing about different numbers.
 */
export async function reopenCounteredApproval(input: {
  id: string;
  amount?: number | null;
  description?: string | null;
}) {
  const store = await readStore();
  const index = store.approvals.findIndex((approval) => approval.id === input.id);
  if (index === -1) return null;
  const existing = store.approvals[index];
  if (existing.status !== "COUNTERED") throw new Error("INVALID_STATE");

  const nextAmount = input.amount == null ? existing.amount : sanitizeAmount(input.amount);
  if (nextAmount === null) throw new Error("INVALID_AMOUNT");

  const now = new Date().toISOString();
  const updated: ClientApprovalRecord = {
    ...existing,
    status: "PENDING",
    amount: nextAmount,
    description:
      input.description !== undefined && input.description !== null
        ? input.description.trim().slice(0, 6000)
        : existing.description,
    counterAmount: null,
    counterNote: null,
    counterAt: null,
    counterByUserId: null,
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
