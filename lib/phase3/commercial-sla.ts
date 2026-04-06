import { randomUUID } from "crypto";
import { JobStatus, JobType } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveBranchPropertyIds } from "@/lib/phase3/branches";

const COMMERCIAL_SLA_RULES_KEY = "phase3_commercial_sla_rules_v1";

export interface CommercialSlaRule {
  id: string;
  name: string;
  isActive: boolean;
  clientId: string | null;
  propertyId: string | null;
  jobType: JobType | null;
  maxStartDelayMinutes: number;
  maxCompletionDelayMinutes: number;
  escalationDelayMinutes: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommercialSlaBreach {
  ruleId: string;
  ruleName: string;
  jobId: string;
  propertyId: string;
  propertyName: string;
  clientId: string | null;
  clientName: string;
  jobType: JobType;
  jobStatus: JobStatus;
  scheduledDate: string;
  scheduledStartAt: string | null;
  dueAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  startDelayMinutes: number | null;
  completionDelayMinutes: number | null;
  breachTypes: Array<"START_DELAY" | "COMPLETION_DELAY" | "OVERDUE_ACTIVE">;
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
}

interface RuleStore {
  rules: CommercialSlaRule[];
}

function sanitizeText(value: unknown, max = 160) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function sanitizeRule(value: unknown): CommercialSlaRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = sanitizeText(row.id, 100);
  const name = sanitizeText(row.name, 160);
  if (!id || !name) return null;
  const createdAtRaw = typeof row.createdAt === "string" ? new Date(row.createdAt) : null;
  const updatedAtRaw = typeof row.updatedAt === "string" ? new Date(row.updatedAt) : null;
  const jobType =
    typeof row.jobType === "string" && Object.values(JobType).includes(row.jobType as JobType)
      ? (row.jobType as JobType)
      : null;
  return {
    id,
    name,
    isActive: row.isActive !== false,
    clientId: sanitizeText(row.clientId, 100) || null,
    propertyId: sanitizeText(row.propertyId, 100) || null,
    jobType,
    maxStartDelayMinutes: Math.max(0, Math.min(1440, Number(row.maxStartDelayMinutes ?? 30))),
    maxCompletionDelayMinutes: Math.max(
      0,
      Math.min(4320, Number(row.maxCompletionDelayMinutes ?? 120))
    ),
    escalationDelayMinutes: Math.max(0, Math.min(1440, Number(row.escalationDelayMinutes ?? 60))),
    notes: sanitizeText(row.notes, 2000) || null,
    createdAt:
      createdAtRaw && !Number.isNaN(createdAtRaw.getTime())
        ? createdAtRaw.toISOString()
        : new Date().toISOString(),
    updatedAt:
      updatedAtRaw && !Number.isNaN(updatedAtRaw.getTime())
        ? updatedAtRaw.toISOString()
        : new Date().toISOString(),
  };
}

async function readStore(): Promise<RuleStore> {
  const row = await db.appSetting.findUnique({ where: { key: COMMERCIAL_SLA_RULES_KEY } });
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { rules: [] };
  const rules = Array.isArray((value as any).rules)
    ? ((value as any).rules as unknown[])
        .map(sanitizeRule)
        .filter((item): item is CommercialSlaRule => Boolean(item))
    : [];
  return { rules };
}

async function writeStore(data: RuleStore) {
  await db.appSetting.upsert({
    where: { key: COMMERCIAL_SLA_RULES_KEY },
    create: { key: COMMERCIAL_SLA_RULES_KEY, value: { rules: data.rules } as any },
    update: { value: { rules: data.rules } as any },
  });
}

export async function listCommercialSlaRules() {
  const store = await readStore();
  return store.rules.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCommercialSlaRuleById(id: string) {
  const rules = await listCommercialSlaRules();
  return rules.find((rule) => rule.id === id) ?? null;
}

export async function createCommercialSlaRule(input: {
  name: string;
  isActive?: boolean;
  clientId?: string | null;
  propertyId?: string | null;
  jobType?: JobType | null;
  maxStartDelayMinutes?: number;
  maxCompletionDelayMinutes?: number;
  escalationDelayMinutes?: number;
  notes?: string | null;
}) {
  const store = await readStore();
  const now = new Date().toISOString();
  const created: CommercialSlaRule = {
    id: randomUUID(),
    name: input.name.trim().slice(0, 160),
    isActive: input.isActive !== false,
    clientId: input.clientId?.trim() || null,
    propertyId: input.propertyId?.trim() || null,
    jobType: input.jobType ?? null,
    maxStartDelayMinutes: Math.max(0, Math.min(1440, Math.round(Number(input.maxStartDelayMinutes ?? 30)))),
    maxCompletionDelayMinutes: Math.max(
      0,
      Math.min(4320, Math.round(Number(input.maxCompletionDelayMinutes ?? 120)))
    ),
    escalationDelayMinutes: Math.max(
      0,
      Math.min(1440, Math.round(Number(input.escalationDelayMinutes ?? 60)))
    ),
    notes: input.notes?.trim().slice(0, 2000) || null,
    createdAt: now,
    updatedAt: now,
  };
  store.rules.push(created);
  if (store.rules.length > 300) store.rules = store.rules.slice(-300);
  await writeStore(store);
  return created;
}

export async function updateCommercialSlaRuleById(
  id: string,
  patch: Partial<Omit<CommercialSlaRule, "id" | "createdAt" | "updatedAt">>
) {
  const store = await readStore();
  const index = store.rules.findIndex((rule) => rule.id === id);
  if (index === -1) return null;
  const existing = store.rules[index];
  const updated: CommercialSlaRule = {
    ...existing,
    name: patch.name !== undefined ? patch.name.trim().slice(0, 160) || existing.name : existing.name,
    isActive: patch.isActive !== undefined ? patch.isActive : existing.isActive,
    clientId: patch.clientId !== undefined ? patch.clientId?.trim() || null : existing.clientId,
    propertyId:
      patch.propertyId !== undefined ? patch.propertyId?.trim() || null : existing.propertyId,
    jobType: patch.jobType !== undefined ? patch.jobType : existing.jobType,
    maxStartDelayMinutes:
      patch.maxStartDelayMinutes !== undefined
        ? Math.max(0, Math.min(1440, Math.round(Number(patch.maxStartDelayMinutes || 0))))
        : existing.maxStartDelayMinutes,
    maxCompletionDelayMinutes:
      patch.maxCompletionDelayMinutes !== undefined
        ? Math.max(0, Math.min(4320, Math.round(Number(patch.maxCompletionDelayMinutes || 0))))
        : existing.maxCompletionDelayMinutes,
    escalationDelayMinutes:
      patch.escalationDelayMinutes !== undefined
        ? Math.max(0, Math.min(1440, Math.round(Number(patch.escalationDelayMinutes || 0))))
        : existing.escalationDelayMinutes,
    notes: patch.notes !== undefined ? patch.notes?.trim().slice(0, 2000) || null : existing.notes,
    updatedAt: new Date().toISOString(),
  };
  store.rules[index] = updated;
  await writeStore(store);
  return updated;
}

export async function deleteCommercialSlaRuleById(id: string) {
  const store = await readStore();
  const before = store.rules.length;
  store.rules = store.rules.filter((rule) => rule.id !== id);
  if (store.rules.length === before) return false;
  await writeStore(store);
  return true;
}

function parseDateTimeOnScheduledDay(scheduledDate: Date, hhmm: string | null | undefined) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [hours, minutes] = hhmm.split(":").map((value) => Number(value));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return new Date(
    Date.UTC(
      scheduledDate.getUTCFullYear(),
      scheduledDate.getUTCMonth(),
      scheduledDate.getUTCDate(),
      hours,
      minutes,
      0,
      0
    )
  );
}

function jobMatchesRule(job: any, rule: CommercialSlaRule) {
  if (!rule.isActive) return false;
  if (rule.clientId && job.property.clientId !== rule.clientId) return false;
  if (rule.propertyId && job.propertyId !== rule.propertyId) return false;
  if (rule.jobType && job.jobType !== rule.jobType) return false;
  return true;
}

export async function evaluateCommercialSla(input?: {
  startDate?: string;
  endDate?: string;
  branchId?: string | null;
}) {
  const rules = await listCommercialSlaRules();
  const activeRules = rules.filter((rule) => rule.isActive);
  if (activeRules.length === 0) {
    return {
      start: input?.startDate ?? null,
      end: input?.endDate ?? null,
      breaches: [] as CommercialSlaBreach[],
    };
  }

  const start = input?.startDate
    ? new Date(`${input.startDate}T00:00:00.000Z`)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const end = input?.endDate
    ? new Date(`${input.endDate}T23:59:59.999Z`)
    : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date range.");
  }

  const branchPropertyIds = await resolveBranchPropertyIds(input?.branchId);
  if (Array.isArray(branchPropertyIds) && branchPropertyIds.length === 0) {
    return { start: start.toISOString(), end: end.toISOString(), breaches: [] as CommercialSlaBreach[] };
  }

  const jobs = await db.job.findMany({
    where: {
      scheduledDate: { gte: start, lte: end },
      ...(Array.isArray(branchPropertyIds) && branchPropertyIds.length > 0
        ? { propertyId: { in: branchPropertyIds } }
        : {}),
    },
    include: {
      property: {
        select: {
          id: true,
          name: true,
          clientId: true,
          client: { select: { name: true } },
        },
      },
      timeLogs: {
        where: { stoppedAt: { not: null } },
        select: { startedAt: true },
        orderBy: { startedAt: "asc" },
      },
    },
    orderBy: { scheduledDate: "desc" },
    take: 5000,
  });

  const breaches: CommercialSlaBreach[] = [];
  const now = new Date();

  for (const job of jobs) {
    const matchingRules = activeRules.filter((rule) => jobMatchesRule(job, rule));
    if (matchingRules.length === 0) continue;
    for (const rule of matchingRules) {
      const scheduledStartAt = parseDateTimeOnScheduledDay(job.scheduledDate, job.startTime);
      const dueAt = parseDateTimeOnScheduledDay(job.scheduledDate, job.dueTime);
      const startedAt = job.timeLogs.length > 0 ? job.timeLogs[0].startedAt : null;
      const completedAt =
        job.status === JobStatus.COMPLETED || job.status === JobStatus.INVOICED
          ? job.updatedAt
          : null;

      const breachTypes: CommercialSlaBreach["breachTypes"] = [];
      let startDelayMinutes: number | null = null;
      let completionDelayMinutes: number | null = null;

      if (scheduledStartAt && startedAt) {
        const delay = Math.round((startedAt.getTime() - scheduledStartAt.getTime()) / 60_000);
        startDelayMinutes = delay;
        if (delay > rule.maxStartDelayMinutes) breachTypes.push("START_DELAY");
      } else if (scheduledStartAt && job.status !== JobStatus.UNASSIGNED && job.status !== JobStatus.OFFERED && job.status !== JobStatus.ASSIGNED) {
        // Job progressed without logged start; treat as unknown start breach candidate.
        const delay = Math.round((now.getTime() - scheduledStartAt.getTime()) / 60_000);
        startDelayMinutes = delay;
        if (delay > rule.maxStartDelayMinutes) breachTypes.push("START_DELAY");
      }

      const completionReference = dueAt ?? scheduledStartAt;
      if (completionReference) {
        if (completedAt) {
          const delay = Math.round((completedAt.getTime() - completionReference.getTime()) / 60_000);
          completionDelayMinutes = delay;
          if (delay > rule.maxCompletionDelayMinutes) breachTypes.push("COMPLETION_DELAY");
        } else {
          const overdueMins = Math.round((now.getTime() - completionReference.getTime()) / 60_000);
          completionDelayMinutes = overdueMins;
          if (
            overdueMins >
            rule.maxCompletionDelayMinutes + Math.max(0, rule.escalationDelayMinutes)
          ) {
            breachTypes.push("OVERDUE_ACTIVE");
          }
        }
      }

      if (breachTypes.length === 0) continue;

      const severity: CommercialSlaBreach["severity"] =
        breachTypes.includes("OVERDUE_ACTIVE")
          ? "CRITICAL"
          : breachTypes.includes("COMPLETION_DELAY")
            ? "HIGH"
            : "MEDIUM";

      breaches.push({
        ruleId: rule.id,
        ruleName: rule.name,
        jobId: job.id,
        propertyId: job.property.id,
        propertyName: job.property.name,
        clientId: job.property.clientId,
        clientName: job.property.client?.name ?? "Unknown",
        jobType: job.jobType,
        jobStatus: job.status,
        scheduledDate: job.scheduledDate.toISOString(),
        scheduledStartAt: scheduledStartAt?.toISOString() ?? null,
        dueAt: dueAt?.toISOString() ?? null,
        startedAt: startedAt?.toISOString() ?? null,
        completedAt: completedAt?.toISOString() ?? null,
        startDelayMinutes,
        completionDelayMinutes,
        breachTypes,
        severity,
      });
    }
  }

  breaches.sort((a, b) => {
    const rank = (severity: CommercialSlaBreach["severity"]) =>
      severity === "CRITICAL" ? 0 : severity === "HIGH" ? 1 : 2;
    const diff = rank(a.severity) - rank(b.severity);
    if (diff !== 0) return diff;
    return b.scheduledDate.localeCompare(a.scheduledDate);
  });

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    breaches,
  };
}
