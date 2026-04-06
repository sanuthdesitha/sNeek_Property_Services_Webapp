import { JobAssignmentResponseStatus, JobType, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import { getAppSettings } from "@/lib/settings";
import { assignPreferredCleanerIfAvailable } from "@/lib/jobs/preferred-cleaner";

const RECURRING_RULES_KEY = "recurring_job_rules_v1";

export interface RecurringJobRule {
  id: string;
  name: string;
  isActive: boolean;
  propertyId: string;
  jobType: JobType;
  daysOfWeek: number[]; // 0-6 (Sun-Sat)
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  startTime?: string;
  dueTime?: string;
  estimatedHours?: number;
  notes?: string;
  assigneeIds: string[];
}

function sanitizeRule(input: unknown): RecurringJobRule | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
  const propertyId = typeof row.propertyId === "string" && row.propertyId.trim() ? row.propertyId.trim() : null;
  const jobType =
    typeof row.jobType === "string" && Object.values(JobType).includes(row.jobType as JobType)
      ? (row.jobType as JobType)
      : null;
  if (!id || !name || !propertyId || !jobType) return null;

  const daysOfWeek = Array.isArray(row.daysOfWeek)
    ? Array.from(
        new Set(
          row.daysOfWeek
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
        )
      ).sort((a, b) => a - b)
    : [];
  if (daysOfWeek.length === 0) return null;

  const assigneeIds = Array.isArray(row.assigneeIds)
    ? Array.from(
        new Set(
          row.assigneeIds
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        )
      )
    : [];

  const isDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const isTime = (value: unknown) => typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
  const estimated = Number(row.estimatedHours);

  return {
    id,
    name,
    isActive: row.isActive !== false,
    propertyId,
    jobType,
    daysOfWeek,
    startDate: isDate(row.startDate) ? (row.startDate as string) : undefined,
    endDate: isDate(row.endDate) ? (row.endDate as string) : undefined,
    startTime: isTime(row.startTime) ? (row.startTime as string) : undefined,
    dueTime: isTime(row.dueTime) ? (row.dueTime as string) : undefined,
    estimatedHours: Number.isFinite(estimated) && estimated > 0 ? estimated : undefined,
    notes: typeof row.notes === "string" && row.notes.trim() ? row.notes.trim() : undefined,
    assigneeIds,
  };
}

function sanitizeRules(input: unknown): RecurringJobRule[] {
  if (!Array.isArray(input)) return [];
  return input.map(sanitizeRule).filter((item): item is RecurringJobRule => Boolean(item));
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function toUtcDateOnly(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dayOfWeekUtc(date: Date) {
  return date.getUTCDay();
}

function matchesRuleDate(rule: RecurringJobRule, key: string) {
  if (rule.startDate && key < rule.startDate) return false;
  if (rule.endDate && key > rule.endDate) return false;
  return true;
}

export async function getRecurringJobRules() {
  const row = await db.appSetting.findUnique({ where: { key: RECURRING_RULES_KEY } });
  return sanitizeRules(row?.value);
}

export async function saveRecurringJobRules(rules: RecurringJobRule[]) {
  const cleaned = sanitizeRules(rules);
  await db.appSetting.upsert({
    where: { key: RECURRING_RULES_KEY },
    create: { key: RECURRING_RULES_KEY, value: cleaned as any },
    update: { value: cleaned as any },
  });
  return cleaned;
}

export async function upsertRecurringJobRule(rule: RecurringJobRule) {
  const rules = await getRecurringJobRules();
  const next = sanitizeRule(rule);
  if (!next) throw new Error("Invalid recurring rule.");
  const index = rules.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    rules[index] = next;
  } else {
    rules.push(next);
  }
  return saveRecurringJobRules(rules);
}

export async function deleteRecurringJobRule(id: string) {
  const rules = await getRecurringJobRules();
  const next = rules.filter((item) => item.id !== id);
  await saveRecurringJobRules(next);
  return next.length !== rules.length;
}

export async function generateRecurringJobs(input: {
  startDate: string;
  endDate: string;
  ruleIds?: string[];
  actorUserId?: string;
}) {
  const start = toUtcDateOnly(input.startDate);
  const end = toUtcDateOnly(input.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw new Error("Invalid date range.");
  }

  const [allRules, settings] = await Promise.all([getRecurringJobRules(), getAppSettings()]);
  if (!settings.recurringJobs.enabled) {
    return { created: 0, skipped: 0, reasons: ["Recurring job generation is disabled in settings."] };
  }

  const rules = allRules.filter((rule) => {
    if (!rule.isActive) return false;
    if (input.ruleIds && input.ruleIds.length > 0 && !input.ruleIds.includes(rule.id)) return false;
    return true;
  });
  if (rules.length === 0) return { created: 0, skipped: 0, reasons: ["No active recurring rules."] };

  const propertyIds = Array.from(new Set(rules.map((rule) => rule.propertyId)));
  const properties = await db.property.findMany({
    where: { id: { in: propertyIds }, isActive: true },
    select: { id: true, name: true, isActive: true },
  });
  const propertyMap = new Map(properties.map((property) => [property.id, property] as const));

  const existingJobs = await db.job.findMany({
    where: {
      propertyId: { in: propertyIds },
      scheduledDate: { gte: start, lte: addDays(end, 1) },
    },
    select: { id: true, propertyId: true, jobType: true, scheduledDate: true, startTime: true, internalNotes: true },
  });
  const existingBaseKeys = new Set<string>();
  const existingRuleKeys = new Set<string>();
  for (const job of existingJobs) {
    const meta = parseJobInternalNotes(job.internalNotes);
    const recurringTag = meta.tags.find((tag) => tag.startsWith("recurring:"));
    const baseKey = `${job.propertyId}|${job.jobType}|${dateKey(job.scheduledDate)}|${job.startTime ?? ""}`;
    existingBaseKeys.add(baseKey);
    if (recurringTag) {
      existingRuleKeys.add(`${baseKey}|${recurringTag}`);
    }
  }

  const activeCleanerIds = new Set(
    (
      await db.user.findMany({
        where: { role: Role.CLEANER, isActive: true },
        select: { id: true },
      })
    ).map((user) => user.id)
  );

  let created = 0;
  let skipped = 0;
  for (const rule of rules) {
    if (!propertyMap.has(rule.propertyId)) {
      skipped += 1;
      continue;
    }

    for (let cursor = new Date(start.getTime()); cursor <= end; cursor = addDays(cursor, 1)) {
      const key = dateKey(cursor);
      if (!matchesRuleDate(rule, key)) continue;
      if (!rule.daysOfWeek.includes(dayOfWeekUtc(cursor))) continue;

      const baseKey = `${rule.propertyId}|${rule.jobType}|${key}|${rule.startTime ?? ""}`;
      const dedupeKey = `${baseKey}|recurring:${rule.id}`;
      if (existingBaseKeys.has(baseKey) || existingRuleKeys.has(dedupeKey)) {
        skipped += 1;
        continue;
      }

      const metaNotes = serializeJobInternalNotes({
        internalNoteText: rule.notes ?? "",
        tags: [`recurring:${rule.id}`, `recurring-name:${rule.name}`],
      });
      const jobNumber = await reserveJobNumber(db);
      const createdJob = await db.job.create({
        data: {
          jobNumber,
          propertyId: rule.propertyId,
          jobType: rule.jobType,
          status: "UNASSIGNED",
          scheduledDate: toUtcDateOnly(key),
          startTime: rule.startTime,
          dueTime: rule.dueTime,
          estimatedHours: rule.estimatedHours,
          notes: rule.notes,
          internalNotes: metaNotes,
        },
        select: { id: true, jobType: true },
      });

      const assigneeIds = rule.assigneeIds.filter((id) => activeCleanerIds.has(id));
      if (assigneeIds.length > 0) {
        const changedAt = new Date();
        for (let index = 0; index < assigneeIds.length; index += 1) {
          const userId = assigneeIds[index];
          await db.jobAssignment.upsert({
            where: { jobId_userId: { jobId: createdJob.id, userId } },
            create: {
              jobId: createdJob.id,
              userId,
              isPrimary: index === 0,
              payRate: settings.cleanerJobHourlyRates?.[userId]?.[createdJob.jobType] ?? undefined,
              offeredAt: changedAt,
              responseStatus: JobAssignmentResponseStatus.PENDING,
              assignedById: input.actorUserId,
            },
            update: {
              removedAt: null,
              isPrimary: index === 0,
              payRate: settings.cleanerJobHourlyRates?.[userId]?.[createdJob.jobType] ?? undefined,
              offeredAt: changedAt,
              responseStatus: JobAssignmentResponseStatus.PENDING,
              respondedAt: null,
              responseNote: null,
              assignedById: input.actorUserId,
              transferredFromUserId: null,
            },
          });
        }
        await db.job.update({
          where: { id: createdJob.id },
          data: { status: "OFFERED" },
        });
      }

      if (input.actorUserId) {
        await db.auditLog.create({
          data: {
            userId: input.actorUserId,
            jobId: createdJob.id,
            action: "CREATE_RECURRING_JOB",
            entity: "Job",
            entityId: createdJob.id,
            after: { recurringRuleId: rule.id, recurringRuleName: rule.name } as any,
          },
        });
      }

      await assignPreferredCleanerIfAvailable({
        jobId: createdJob.id,
        propertyId: rule.propertyId,
        jobType: createdJob.jobType,
      });

      existingBaseKeys.add(baseKey);
      existingRuleKeys.add(dedupeKey);
      created += 1;
    }
  }

  return { created, skipped, reasons: [] as string[] };
}
