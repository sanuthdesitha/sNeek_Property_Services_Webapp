import { randomUUID } from "crypto";
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";

const CONTINUATION_KEY = "job_continuation_requests_v1";

export type ContinuationRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface ContinuationProgressSnapshot {
  formData: Record<string, unknown>;
  uploads: Record<string, string[]>;
  laundryReady: boolean;
  bagLocation: string | null;
  resolvedCarryForwardIds: string[];
  hasMissedTask: boolean;
  missedTaskNotes: string[];
  capturedAt: string;
}

export interface ContinuationRequest {
  id: string;
  jobId: string;
  requestedByUserId: string;
  reason: string;
  preferredDate: string | null;
  estimatedRemainingHours: number | null;
  status: ContinuationRequestStatus;
  requestedAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decisionNote: string | null;
  continuationJobId: string | null;
  snapshot: {
    jobStatus: string;
    estimatedHours: number | null;
    loggedMinutesByCleaner: Array<{
      cleanerId: string;
      cleanerName: string;
      minutes: number;
      payRate: number | null;
    }>;
  };
  approvalPlan: {
    newScheduledDate: string | null;
    newCleanerId: string | null;
    previousCleanerHours: number | null;
    newCleanerHours: number | null;
    newCleanerPayRate: number | null;
    transportAllowance: number | null;
  };
  progressSnapshot: ContinuationProgressSnapshot | null;
}

interface StoreData {
  requests: ContinuationRequest[];
}

const DEFAULT_STORE: StoreData = { requests: [] };

function sanitizeText(value: unknown, max = 1200) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function sanitizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

function sanitizeStatus(value: unknown): ContinuationRequestStatus {
  return value === "APPROVED" || value === "REJECTED" ? value : "PENDING";
}

function sanitizeProgressSnapshot(value: unknown): ContinuationProgressSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const formDataRaw =
    row.formData && typeof row.formData === "object" && !Array.isArray(row.formData)
      ? (row.formData as Record<string, unknown>)
      : {};
  const uploadsRaw =
    row.uploads && typeof row.uploads === "object" && !Array.isArray(row.uploads)
      ? (row.uploads as Record<string, unknown>)
      : {};

  const formDataEntries = Object.entries(formDataRaw).slice(0, 500);
  const uploadsEntries = Object.entries(uploadsRaw).slice(0, 200);

  const sanitizedUploads = uploadsEntries.reduce<Record<string, string[]>>((acc, [fieldId, keysRaw]) => {
    const cleanField = sanitizeText(fieldId, 120);
    if (!cleanField || !Array.isArray(keysRaw)) return acc;
    const keys = keysRaw
      .filter((item): item is string => typeof item === "string")
      .map((item) => sanitizeText(item, 400))
      .filter(Boolean)
      .slice(0, 100);
    if (keys.length > 0) {
      acc[cleanField] = keys;
    }
    return acc;
  }, {});

  return {
    formData: Object.fromEntries(formDataEntries),
    uploads: sanitizedUploads,
    laundryReady: row.laundryReady === true,
    bagLocation: sanitizeText(row.bagLocation, 400) || null,
    resolvedCarryForwardIds: Array.isArray(row.resolvedCarryForwardIds)
      ? row.resolvedCarryForwardIds
          .filter((item): item is string => typeof item === "string")
          .map((item) => sanitizeText(item, 100))
          .filter(Boolean)
          .slice(0, 200)
      : [],
    hasMissedTask: row.hasMissedTask === true,
    missedTaskNotes: Array.isArray(row.missedTaskNotes)
      ? row.missedTaskNotes
          .filter((item): item is string => typeof item === "string")
          .map((item) => sanitizeText(item, 2000))
          .filter(Boolean)
          .slice(0, 200)
      : [],
    capturedAt: sanitizeText(row.capturedAt, 40) || new Date().toISOString(),
  };
}

function sanitizeRequest(value: unknown): ContinuationRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = sanitizeText(row.id, 100);
  const jobId = sanitizeText(row.jobId, 100);
  const requestedByUserId = sanitizeText(row.requestedByUserId, 100);
  if (!id || !jobId || !requestedByUserId) return null;
  const snapshotRaw =
    row.snapshot && typeof row.snapshot === "object" && !Array.isArray(row.snapshot)
      ? (row.snapshot as Record<string, unknown>)
      : {};
  const planRaw =
    row.approvalPlan && typeof row.approvalPlan === "object" && !Array.isArray(row.approvalPlan)
      ? (row.approvalPlan as Record<string, unknown>)
      : {};
  const progressSnapshot = sanitizeProgressSnapshot(row.progressSnapshot);
  return {
    id,
    jobId,
    requestedByUserId,
    reason: sanitizeText(row.reason, 2000),
    preferredDate: sanitizeDate(row.preferredDate),
    estimatedRemainingHours:
      row.estimatedRemainingHours == null ? null : Math.max(0, Number(row.estimatedRemainingHours || 0)),
    status: sanitizeStatus(row.status),
    requestedAt: sanitizeText(row.requestedAt, 40) || new Date().toISOString(),
    decidedAt: sanitizeText(row.decidedAt, 40) || null,
    decidedByUserId: sanitizeText(row.decidedByUserId, 100) || null,
    decisionNote: sanitizeText(row.decisionNote, 2000) || null,
    continuationJobId: sanitizeText(row.continuationJobId, 100) || null,
    snapshot: {
      jobStatus: sanitizeText(snapshotRaw.jobStatus, 40) || "UNKNOWN",
      estimatedHours:
        snapshotRaw.estimatedHours == null ? null : Math.max(0, Number(snapshotRaw.estimatedHours || 0)),
      loggedMinutesByCleaner: Array.isArray(snapshotRaw.loggedMinutesByCleaner)
        ? snapshotRaw.loggedMinutesByCleaner
            .map((item) => {
              if (!item || typeof item !== "object" || Array.isArray(item)) return null;
              const entry = item as Record<string, unknown>;
              const cleanerId = sanitizeText(entry.cleanerId, 100);
              if (!cleanerId) return null;
              return {
                cleanerId,
                cleanerName: sanitizeText(entry.cleanerName, 180) || cleanerId,
                minutes: Math.max(0, Number(entry.minutes || 0)),
                payRate: entry.payRate == null ? null : Math.max(0, Number(entry.payRate || 0)),
              };
            })
            .filter(
              (
                item
              ): item is {
                cleanerId: string;
                cleanerName: string;
                minutes: number;
                payRate: number | null;
              } => Boolean(item)
            )
        : [],
    },
    approvalPlan: {
      newScheduledDate: sanitizeDate(planRaw.newScheduledDate),
      newCleanerId: sanitizeText(planRaw.newCleanerId, 100) || null,
      previousCleanerHours:
        planRaw.previousCleanerHours == null ? null : Math.max(0, Number(planRaw.previousCleanerHours || 0)),
      newCleanerHours:
        planRaw.newCleanerHours == null ? null : Math.max(0, Number(planRaw.newCleanerHours || 0)),
      newCleanerPayRate:
        planRaw.newCleanerPayRate == null ? null : Math.max(0, Number(planRaw.newCleanerPayRate || 0)),
      transportAllowance:
        planRaw.transportAllowance == null ? null : Math.max(0, Number(planRaw.transportAllowance || 0)),
    },
    progressSnapshot,
  };
}

function sanitizeStore(value: unknown): StoreData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_STORE;
  const row = value as Record<string, unknown>;
  const requests = Array.isArray(row.requests)
    ? row.requests.map(sanitizeRequest).filter((item): item is ContinuationRequest => Boolean(item))
    : [];
  return { requests };
}

async function readStore() {
  const row = await db.appSetting.findUnique({ where: { key: CONTINUATION_KEY } });
  return sanitizeStore(row?.value);
}

async function writeStore(data: StoreData) {
  await db.appSetting.upsert({
    where: { key: CONTINUATION_KEY },
    create: { key: CONTINUATION_KEY, value: data as any },
    update: { value: data as any },
  });
}

async function buildSnapshot(jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      assignments: {
        where: { removedAt: null },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      timeLogs: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  if (!job) throw new Error("Job not found.");

  const minutesByUser = new Map<string, number>();
  for (const log of job.timeLogs) {
    const mins = Number(log.durationM ?? 0);
    if (mins <= 0) continue;
    minutesByUser.set(log.userId, (minutesByUser.get(log.userId) ?? 0) + mins);
  }

  const loggedMinutesByCleaner = job.assignments.map((assignment) => ({
    cleanerId: assignment.userId,
    cleanerName: assignment.user.name ?? assignment.user.email ?? assignment.userId,
    minutes: minutesByUser.get(assignment.userId) ?? 0,
    payRate: assignment.payRate ?? null,
  }));

  return {
    job,
    snapshot: {
      jobStatus: job.status,
      estimatedHours: job.estimatedHours ?? null,
      loggedMinutesByCleaner,
    },
  };
}

export async function listContinuationRequests(input?: {
  status?: ContinuationRequestStatus;
  jobId?: string;
  requestedByUserId?: string;
}) {
  const store = await readStore();
  return store.requests
    .filter((item) => {
      if (input?.status && item.status !== input.status) return false;
      if (input?.jobId && item.jobId !== input.jobId) return false;
      if (input?.requestedByUserId && item.requestedByUserId !== input.requestedByUserId) return false;
      return true;
    })
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export async function getContinuationRequestById(id: string) {
  const rows = await listContinuationRequests();
  return rows.find((row) => row.id === id) ?? null;
}

export async function getApprovedContinuationProgressSnapshot(continuationJobId: string) {
  const store = await readStore();
  const row = store.requests.find(
    (item) =>
      item.status === "APPROVED" &&
      item.continuationJobId === continuationJobId &&
      item.progressSnapshot
  );
  return row?.progressSnapshot ?? null;
}

export async function createContinuationRequest(input: {
  jobId: string;
  requestedByUserId: string;
  reason: string;
  preferredDate?: string | null;
  estimatedRemainingHours?: number | null;
  progressSnapshot?: ContinuationProgressSnapshot | null;
}) {
  const store = await readStore();
  const pendingForJob = store.requests.find((item) => item.jobId === input.jobId && item.status === "PENDING");
  if (pendingForJob) throw new Error("A continuation request is already pending for this job.");
  const { snapshot } = await buildSnapshot(input.jobId);
  const now = new Date().toISOString();
  const created: ContinuationRequest = {
    id: randomUUID(),
    jobId: input.jobId,
    requestedByUserId: input.requestedByUserId,
    reason: sanitizeText(input.reason, 2000),
    preferredDate: sanitizeDate(input.preferredDate) ?? null,
    estimatedRemainingHours:
      input.estimatedRemainingHours == null ? null : Math.max(0, Number(input.estimatedRemainingHours || 0)),
    status: "PENDING",
    requestedAt: now,
    decidedAt: null,
    decidedByUserId: null,
    decisionNote: null,
    continuationJobId: null,
    snapshot,
    approvalPlan: {
      newScheduledDate: null,
      newCleanerId: null,
      previousCleanerHours: null,
      newCleanerHours: null,
      newCleanerPayRate: null,
      transportAllowance: null,
    },
    progressSnapshot: sanitizeProgressSnapshot(input.progressSnapshot ?? null),
  };
  store.requests.unshift(created);
  if (store.requests.length > 2000) {
    store.requests = store.requests.slice(0, 2000);
  }
  await writeStore(store);
  return created;
}

function parseScheduledDate(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime())) throw new Error("Invalid scheduled date.");
  return value;
}

export async function decideContinuationRequest(input: {
  id: string;
  decidedByUserId: string;
  decision: "APPROVE" | "REJECT";
  decisionNote?: string | null;
  newScheduledDate?: string | null;
  newCleanerId?: string | null;
  previousCleanerHours?: number | null;
  newCleanerHours?: number | null;
  newCleanerPayRate?: number | null;
  transportAllowance?: number | null;
}) {
  const store = await readStore();
  const index = store.requests.findIndex((item) => item.id === input.id);
  if (index < 0) throw new Error("Continuation request not found.");
  const current = store.requests[index];
  if (current.status !== "PENDING") throw new Error("This request is already decided.");
  const now = new Date().toISOString();

  if (input.decision === "REJECT") {
    const rejected: ContinuationRequest = {
      ...current,
      status: "REJECTED",
      decidedAt: now,
      decidedByUserId: input.decidedByUserId,
      decisionNote: sanitizeText(input.decisionNote, 2000) || null,
    };
    store.requests[index] = rejected;
    await writeStore(store);
    return rejected;
  }

  const scheduledDateRaw = sanitizeDate(input.newScheduledDate);
  if (!scheduledDateRaw) throw new Error("New scheduled date is required.");
  const scheduledDate = parseScheduledDate(scheduledDateRaw);

  const currentJob = await db.job.findUnique({
    where: { id: current.jobId },
    include: {
      assignments: {
        where: { removedAt: null },
        select: { userId: true, payRate: true },
      },
    },
  });
  if (!currentJob) throw new Error("Job not found.");

  const settings = await getAppSettings();
  const nextCleanerId = sanitizeText(input.newCleanerId, 100) || null;
  const previousCleanerHours =
    input.previousCleanerHours == null ? null : Math.max(0, Number(input.previousCleanerHours || 0));
  const newCleanerHours =
    input.newCleanerHours == null ? null : Math.max(0, Number(input.newCleanerHours || 0));
  const transportAllowance =
    input.transportAllowance == null ? null : Math.max(0, Number(input.transportAllowance || 0));
  let cleanerPayRate =
    input.newCleanerPayRate == null ? null : Math.max(0, Number(input.newCleanerPayRate || 0));

  let assignedCleanerExists = false;
  if (nextCleanerId) {
    const cleaner = await db.user.findUnique({
      where: { id: nextCleanerId },
      select: { id: true, role: true, isActive: true },
    });
    if (!cleaner || cleaner.role !== "CLEANER" || !cleaner.isActive) {
      throw new Error("Selected cleaner is invalid.");
    }
    assignedCleanerExists = true;
    if (cleanerPayRate == null) {
      cleanerPayRate =
        settings.cleanerJobHourlyRates?.[nextCleanerId]?.[currentJob.jobType] ??
        currentJob.assignments.find((a) => a.userId === nextCleanerId)?.payRate ??
        null;
    }
  }

  const continuationMeta = parseJobInternalNotes(currentJob.internalNotes);
  if (transportAllowance != null && transportAllowance > 0 && nextCleanerId) {
    continuationMeta.transportAllowances = {
      ...(continuationMeta.transportAllowances ?? {}),
      [nextCleanerId]: transportAllowance,
    };
  }
  continuationMeta.tags = Array.from(new Set([...(continuationMeta.tags ?? []), `continuation-of:${currentJob.id}`]));

  const createdContinuation = await db.$transaction(async (tx) => {
    const continuation = await tx.job.create({
      data: {
        propertyId: currentJob.propertyId,
        jobType: currentJob.jobType,
        status: assignedCleanerExists ? JobStatus.ASSIGNED : JobStatus.UNASSIGNED,
        scheduledDate,
        startTime: currentJob.startTime,
        endTime: currentJob.endTime,
        dueTime: currentJob.dueTime,
        estimatedHours: newCleanerHours ?? currentJob.estimatedHours ?? null,
        notes: [currentJob.notes ?? "", `Continuation of job ${currentJob.id}`].filter(Boolean).join("\n"),
        internalNotes: serializeJobInternalNotes(continuationMeta),
      },
    });

    if (nextCleanerId) {
      await tx.jobAssignment.upsert({
        where: { jobId_userId: { jobId: continuation.id, userId: nextCleanerId } },
        create: {
          jobId: continuation.id,
          userId: nextCleanerId,
          isPrimary: true,
          payRate: cleanerPayRate ?? undefined,
        },
        update: {
          isPrimary: true,
          payRate: cleanerPayRate ?? undefined,
        },
      });
    }

    const originMeta = parseJobInternalNotes(currentJob.internalNotes);
    originMeta.tags = Array.from(
      new Set([...(originMeta.tags ?? []), `continued-to:${continuation.id}`])
    );
    originMeta.internalNoteText = [
      originMeta.internalNoteText,
      `Continuation approved (${continuation.id})`,
    ]
      .filter(Boolean)
      .join("\n");

    await tx.job.update({
      where: { id: currentJob.id },
      data: {
        status:
          currentJob.status === JobStatus.SUBMITTED ||
          currentJob.status === JobStatus.QA_REVIEW ||
          currentJob.status === JobStatus.COMPLETED ||
          currentJob.status === JobStatus.INVOICED
            ? currentJob.status
            : JobStatus.SUBMITTED,
        estimatedHours: previousCleanerHours ?? currentJob.estimatedHours ?? null,
        internalNotes: serializeJobInternalNotes(originMeta),
      },
    });

    return continuation;
  });

  const approved: ContinuationRequest = {
    ...current,
    status: "APPROVED",
    decidedAt: now,
    decidedByUserId: input.decidedByUserId,
    decisionNote: sanitizeText(input.decisionNote, 2000) || null,
    continuationJobId: createdContinuation.id,
    approvalPlan: {
      newScheduledDate: scheduledDateRaw,
      newCleanerId: nextCleanerId,
      previousCleanerHours,
      newCleanerHours,
      newCleanerPayRate: cleanerPayRate,
      transportAllowance,
    },
  };
  store.requests[index] = approved;
  await writeStore(store);
  return approved;
}
