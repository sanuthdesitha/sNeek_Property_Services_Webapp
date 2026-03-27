import { randomUUID } from "crypto";
import { db } from "@/lib/db";

const EARLY_CHECKOUT_REQUESTS_KEY = "job_early_checkout_requests_v1";

export type EarlyCheckoutRequestStatus = "PENDING" | "ACKNOWLEDGED" | "CANCELLED";

export interface EarlyCheckoutRequestRecord {
  id: string;
  jobId: string;
  propertyId: string;
  requestedById: string;
  requestedAt: string;
  requestedStartTime: string | null;
  note: string | null;
  status: EarlyCheckoutRequestStatus;
  acknowledgedById: string | null;
  acknowledgedAt: string | null;
  cancelledById: string | null;
  cancelledAt: string | null;
}

interface EarlyCheckoutRequestStore {
  requests: EarlyCheckoutRequestRecord[];
}

function defaultStore(): EarlyCheckoutRequestStore {
  return { requests: [] };
}

function sanitizeId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function sanitizeOptionalText(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function sanitizeOptionalTime(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
}

function sanitizeStatus(value: unknown): EarlyCheckoutRequestStatus {
  return value === "ACKNOWLEDGED" || value === "CANCELLED" ? value : "PENDING";
}

function normalizeRecord(row: unknown): EarlyCheckoutRequestRecord | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const value = row as Record<string, unknown>;
  const id = sanitizeId(value.id);
  const jobId = sanitizeId(value.jobId);
  const propertyId = sanitizeId(value.propertyId);
  const requestedById = sanitizeId(value.requestedById);
  const requestedAt =
    typeof value.requestedAt === "string" && value.requestedAt.trim()
      ? value.requestedAt.trim()
      : new Date().toISOString();

  if (!id || !jobId || !propertyId || !requestedById) return null;

  return {
    id,
    jobId,
    propertyId,
    requestedById,
    requestedAt,
    requestedStartTime: sanitizeOptionalTime(value.requestedStartTime),
    note: sanitizeOptionalText(value.note, 2000),
    status: sanitizeStatus(value.status),
    acknowledgedById: sanitizeId(value.acknowledgedById) || null,
    acknowledgedAt:
      typeof value.acknowledgedAt === "string" && value.acknowledgedAt.trim()
        ? value.acknowledgedAt.trim()
        : null,
    cancelledById: sanitizeId(value.cancelledById) || null,
    cancelledAt:
      typeof value.cancelledAt === "string" && value.cancelledAt.trim()
        ? value.cancelledAt.trim()
        : null,
  };
}

async function readStore(): Promise<EarlyCheckoutRequestStore> {
  const row = await db.appSetting.findUnique({ where: { key: EARLY_CHECKOUT_REQUESTS_KEY } });
  if (!row?.value || typeof row.value !== "object" || Array.isArray(row.value)) {
    return defaultStore();
  }
  const rawRequests = Array.isArray((row.value as Record<string, unknown>).requests)
    ? ((row.value as Record<string, unknown>).requests as unknown[])
    : [];
  return {
    requests: rawRequests
      .map((item) => normalizeRecord(item))
      .filter((item): item is EarlyCheckoutRequestRecord => Boolean(item))
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()),
  };
}

async function writeStore(store: EarlyCheckoutRequestStore) {
  await db.appSetting.upsert({
    where: { key: EARLY_CHECKOUT_REQUESTS_KEY },
    create: { key: EARLY_CHECKOUT_REQUESTS_KEY, value: { requests: store.requests } as any },
    update: { value: { requests: store.requests } as any },
  });
}

export async function listEarlyCheckoutRequests(input?: {
  jobId?: string;
  propertyId?: string;
  status?: EarlyCheckoutRequestStatus;
}) {
  const store = await readStore();
  return store.requests.filter((row) => {
    if (input?.jobId && row.jobId !== input.jobId) return false;
    if (input?.propertyId && row.propertyId !== input.propertyId) return false;
    if (input?.status && row.status !== input.status) return false;
    return true;
  });
}

export async function createEarlyCheckoutRequest(input: {
  jobId: string;
  propertyId: string;
  requestedById: string;
  requestedStartTime?: string | null;
  note?: string | null;
}) {
  const store = await readStore();
  const now = new Date().toISOString();
  const created: EarlyCheckoutRequestRecord = {
    id: randomUUID(),
    jobId: input.jobId,
    propertyId: input.propertyId,
    requestedById: input.requestedById,
    requestedAt: now,
    requestedStartTime: sanitizeOptionalTime(input.requestedStartTime),
    note: sanitizeOptionalText(input.note, 2000),
    status: "PENDING",
    acknowledgedById: null,
    acknowledgedAt: null,
    cancelledById: null,
    cancelledAt: null,
  };
  store.requests = [created, ...store.requests.filter((row) => row.jobId !== input.jobId || row.status !== "PENDING")];
  await writeStore(store);
  return created;
}

export async function acknowledgeEarlyCheckoutRequest(input: {
  id: string;
  acknowledgedById: string;
}) {
  const store = await readStore();
  const request = store.requests.find((row) => row.id === input.id);
  if (!request) throw new Error("Early checkout request not found.");
  request.status = "ACKNOWLEDGED";
  request.acknowledgedById = input.acknowledgedById;
  request.acknowledgedAt = new Date().toISOString();
  await writeStore(store);
  return request;
}

export async function cancelEarlyCheckoutRequest(input: {
  id: string;
  cancelledById: string;
}) {
  const store = await readStore();
  const request = store.requests.find((row) => row.id === input.id);
  if (!request) throw new Error("Early checkout request not found.");
  request.status = "CANCELLED";
  request.cancelledById = input.cancelledById;
  request.cancelledAt = new Date().toISOString();
  await writeStore(store);
  return request;
}
