import { randomUUID } from "crypto";
import { db } from "@/lib/db";

const TIMING_REQUESTS_KEY = "job_early_checkout_requests_v1";

export type TimingRequestType = "EARLY_CHECKIN" | "LATE_CHECKOUT";
export type EarlyCheckoutRequestStatus = "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED";

export interface EarlyCheckoutRequestRecord {
  id: string;
  jobId: string;
  propertyId: string;
  requestedById: string;
  requestedAt: string;
  requestType: TimingRequestType;
  requestedTime: string | null;
  note: string | null;
  status: EarlyCheckoutRequestStatus;
  decisionToken: string;
  decidedById: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  cancelledById: string | null;
  cancelledAt: string | null;
}

interface TimingRequestStore {
  requests: EarlyCheckoutRequestRecord[];
}

function defaultStore(): TimingRequestStore {
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
  return value === "APPROVED" || value === "DECLINED" || value === "CANCELLED" ? value : "PENDING";
}

function sanitizeType(value: unknown): TimingRequestType {
  return value === "LATE_CHECKOUT" ? "LATE_CHECKOUT" : "EARLY_CHECKIN";
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
    requestType: sanitizeType(value.requestType),
    requestedTime: sanitizeOptionalTime(value.requestedTime ?? value.requestedStartTime),
    note: sanitizeOptionalText(value.note, 2000),
    status: sanitizeStatus(value.status),
    decisionToken: sanitizeId(value.decisionToken) || randomUUID(),
    decidedById: sanitizeId(value.decidedById ?? value.acknowledgedById) || null,
    decidedAt:
      typeof (value.decidedAt ?? value.acknowledgedAt) === "string" &&
      String(value.decidedAt ?? value.acknowledgedAt).trim()
        ? String(value.decidedAt ?? value.acknowledgedAt).trim()
        : null,
    decisionNote: sanitizeOptionalText(value.decisionNote, 2000),
    cancelledById: sanitizeId(value.cancelledById) || null,
    cancelledAt:
      typeof value.cancelledAt === "string" && value.cancelledAt.trim()
        ? value.cancelledAt.trim()
        : null,
  };
}

async function readStore(): Promise<TimingRequestStore> {
  const row = await db.appSetting.findUnique({ where: { key: TIMING_REQUESTS_KEY } });
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

async function writeStore(store: TimingRequestStore) {
  await db.appSetting.upsert({
    where: { key: TIMING_REQUESTS_KEY },
    create: { key: TIMING_REQUESTS_KEY, value: { requests: store.requests } as any },
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
  requestType: TimingRequestType;
  requestedTime?: string | null;
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
    requestType: sanitizeType(input.requestType),
    requestedTime: sanitizeOptionalTime(input.requestedTime),
    note: sanitizeOptionalText(input.note, 2000),
    status: "PENDING",
    decisionToken: randomUUID(),
    decidedById: null,
    decidedAt: null,
    decisionNote: null,
    cancelledById: null,
    cancelledAt: null,
  };
  store.requests = [
    created,
    ...store.requests.filter((row) => row.jobId !== input.jobId || row.status !== "PENDING"),
  ];
  await writeStore(store);
  return created;
}

function applyTimingDecisionToJob(input: {
  requestType: TimingRequestType;
  requestedTime: string | null;
}) {
  if (!input.requestedTime) return {};
  if (input.requestType === "LATE_CHECKOUT") {
    return {
      startTime: input.requestedTime,
    };
  }
  return {
    dueTime: input.requestedTime,
  };
}

export async function decideEarlyCheckoutRequest(input: {
  id: string;
  decidedById: string;
  decision: "APPROVE" | "DECLINE";
  decisionNote?: string | null;
}) {
  const store = await readStore();
  const request = store.requests.find((row) => row.id === input.id);
  if (!request) throw new Error("Timing update request not found.");
  if (request.status !== "PENDING") throw new Error("This timing update request is already closed.");

  request.status = input.decision === "APPROVE" ? "APPROVED" : "DECLINED";
  request.decidedById = input.decidedById;
  request.decidedAt = new Date().toISOString();
  request.decisionNote = sanitizeOptionalText(input.decisionNote, 2000);

  if (input.decision === "APPROVE") {
    await db.job.update({
      where: { id: request.jobId },
      data: applyTimingDecisionToJob({
        requestType: request.requestType,
        requestedTime: request.requestedTime,
      }),
    });
  }

  await writeStore(store);
  return request;
}

export async function cancelEarlyCheckoutRequest(input: {
  id: string;
  cancelledById: string;
}) {
  const store = await readStore();
  const request = store.requests.find((row) => row.id === input.id);
  if (!request) throw new Error("Timing update request not found.");
  request.status = "CANCELLED";
  request.cancelledById = input.cancelledById;
  request.cancelledAt = new Date().toISOString();
  await writeStore(store);
  return request;
}
