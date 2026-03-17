import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { getBranchById, listBranches, resolveBranchPropertyIds } from "@/lib/phase3/branches";
import { suggestAutoAssignment } from "@/lib/ops/dispatch";

function parseDateOnly(value?: string | null, endOfDay = false) {
  if (!value) return null;
  const time = endOfDay ? "23:59:59.999Z" : "00:00:00.000Z";
  const date = new Date(`${value}T${time}`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toDateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function buildDueAt(job: { scheduledDate: Date; dueTime: string | null }) {
  const dueTime = job.dueTime ?? "15:00";
  const [hoursRaw, minsRaw] = dueTime.split(":");
  const h = Number(hoursRaw);
  const m = Number(minsRaw);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return new Date(job.scheduledDate.getTime() + 15 * 3600_000);
  }
  const date = new Date(job.scheduledDate);
  date.setUTCHours(h, m, 0, 0);
  return date;
}

export async function buildSlaHeatmap(input?: {
  startDate?: string | null;
  endDate?: string | null;
  branchId?: string | null;
}) {
  const settings = await getAppSettings();
  const start = parseDateOnly(input?.startDate ?? null) ?? new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const end =
    parseDateOnly(input?.endDate ?? null, true) ??
    new Date(start.getTime() + 13 * 24 * 3600_000 + (24 * 3600_000 - 1));
  const propertyIds = await resolveBranchPropertyIds(input?.branchId ?? null);

  const jobs = await db.job.findMany({
    where: {
      scheduledDate: { gte: start, lte: end },
      ...(Array.isArray(propertyIds) ? { propertyId: { in: propertyIds } } : {}),
    },
    select: {
      id: true,
      status: true,
      scheduledDate: true,
      dueTime: true,
      property: {
        select: {
          id: true,
          name: true,
          suburb: true,
          client: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ scheduledDate: "asc" }, { createdAt: "asc" }],
  });

  const now = new Date();
  const completedStatuses = new Set<JobStatus>([JobStatus.COMPLETED, JobStatus.INVOICED]);
  const warnMs = settings.sla.warnHoursBeforeDue * 3600_000;
  const cells = new Map<
    string,
    {
      propertyId: string;
      propertyName: string;
      suburb: string;
      clientName: string;
      date: string;
      totalJobs: number;
      dueSoon: number;
      overdue: number;
    }
  >();

  for (const job of jobs) {
    const dateKey = toDateKey(job.scheduledDate);
    const mapKey = `${job.property.id}::${dateKey}`;
    if (!cells.has(mapKey)) {
      cells.set(mapKey, {
        propertyId: job.property.id,
        propertyName: job.property.name,
        suburb: job.property.suburb,
        clientName: job.property.client?.name ?? "Unknown",
        date: dateKey,
        totalJobs: 0,
        dueSoon: 0,
        overdue: 0,
      });
    }
    const cell = cells.get(mapKey)!;
    cell.totalJobs += 1;
    const dueAt = buildDueAt(job);
    if (!completedStatuses.has(job.status as JobStatus)) {
      if (dueAt.getTime() < now.getTime()) {
        cell.overdue += 1;
      } else if (dueAt.getTime() - now.getTime() <= warnMs) {
        cell.dueSoon += 1;
      }
    }
  }

  const entries = Array.from(cells.values()).sort((a, b) => {
    if (a.propertyName !== b.propertyName) return a.propertyName.localeCompare(b.propertyName);
    return a.date.localeCompare(b.date);
  });

  return {
    startDate: toDateKey(start),
    endDate: toDateKey(end),
    branchId: input?.branchId ?? null,
    summary: {
      properties: new Set(entries.map((entry) => entry.propertyId)).size,
      jobs: entries.reduce((sum, entry) => sum + entry.totalJobs, 0),
      dueSoon: entries.reduce((sum, entry) => sum + entry.dueSoon, 0),
      overdue: entries.reduce((sum, entry) => sum + entry.overdue, 0),
    },
    entries,
  };
}

export async function buildBranchScorecards(input?: {
  startDate?: string | null;
  endDate?: string | null;
}) {
  const start = parseDateOnly(input?.startDate ?? null) ?? new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const end =
    parseDateOnly(input?.endDate ?? null, true) ??
    new Date(start.getTime() + 30 * 24 * 3600_000 - 1);

  const branches = await listBranches();
  const activeBranches = branches.filter((branch) => branch.isActive);

  const jobs = await db.job.findMany({
    where: { scheduledDate: { gte: start, lte: end } },
    select: {
      id: true,
      propertyId: true,
      status: true,
      estimatedHours: true,
      jobType: true,
      assignments: {
        where: { removedAt: null },
        select: { payRate: true },
      },
      qaReviews: { select: { score: true } },
    },
  });

  const quotes = await db.quote.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      status: { in: ["ACCEPTED", "CONVERTED"] },
    },
    select: { id: true, clientId: true, totalAmount: true },
  });

  const lowStockRows = await db.propertyStock.findMany({
    where: {
      onHand: { lt: 1_000_000 },
    },
    select: {
      propertyId: true,
      onHand: true,
      reorderThreshold: true,
    },
  });

  const scorecards: Array<{
    branchId: string;
    branchName: string;
    jobs: number;
    completedJobs: number;
    qaAvg: number | null;
    revenue: number;
    estimatedLaborCost: number;
    lowStockCount: number;
    margin: number;
    marginPct: number | null;
  }> = [];

  for (const branch of activeBranches) {
    const propertySet = new Set(branch.propertyIds);
    const branchJobs = jobs.filter((job) => propertySet.has(job.propertyId));
    const completedJobs = branchJobs.filter(
      (job) => job.status === JobStatus.COMPLETED || job.status === JobStatus.INVOICED
    );
    const qaScores = branchJobs.flatMap((job) => job.qaReviews.map((qa) => Number(qa.score || 0))).filter((v) => v > 0);
    const estimatedLaborCost = branchJobs.reduce((sum, job) => {
      const hours = Number(job.estimatedHours ?? 0);
      if (hours <= 0) return sum;
      const split = Math.max(1, job.assignments.length);
      const avgRate =
        job.assignments.length > 0
          ? job.assignments.reduce((n, assignment) => n + Number(assignment.payRate ?? 40), 0) /
            job.assignments.length
          : 40;
      return sum + (hours / split) * avgRate;
    }, 0);
    const lowStockCount = lowStockRows.filter(
      (row) => propertySet.has(row.propertyId) && row.onHand <= row.reorderThreshold
    ).length;
    const branchClientIds = new Set(
      (
        await db.property.findMany({
          where: { id: { in: Array.from(propertySet) } },
          select: { clientId: true },
        })
      ).map((row) => row.clientId)
    );
    const revenue = quotes
      .filter((quote) => quote.clientId && branchClientIds.has(quote.clientId))
      .reduce((sum, quote) => sum + Number(quote.totalAmount ?? 0), 0);
    const margin = revenue - estimatedLaborCost;
    scorecards.push({
      branchId: branch.id,
      branchName: branch.name,
      jobs: branchJobs.length,
      completedJobs: completedJobs.length,
      qaAvg: qaScores.length ? Number((qaScores.reduce((a, b) => a + b, 0) / qaScores.length).toFixed(2)) : null,
      revenue: Number(revenue.toFixed(2)),
      estimatedLaborCost: Number(estimatedLaborCost.toFixed(2)),
      lowStockCount,
      margin: Number(margin.toFixed(2)),
      marginPct: revenue > 0 ? Number(((margin / revenue) * 100).toFixed(2)) : null,
    });
  }

  return {
    startDate: toDateKey(start),
    endDate: toDateKey(end),
    scorecards,
  };
}

export async function suggestReschedulePlan(jobId: string, options?: { daysAhead?: number }) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      property: { select: { name: true, defaultCheckoutTime: true, defaultCheckinTime: true } },
      assignments: { where: { removedAt: null }, select: { userId: true } },
    },
  });
  if (!job) throw new Error("Job not found.");
  const daysAhead = Math.max(1, Math.min(30, Math.round(Number(options?.daysAhead ?? 7))));
  const base = new Date(job.scheduledDate);

  const suggestions: Array<{
    date: string;
    startTime: string;
    dueTime: string;
    reason: string;
    cleanerSuggestions: Array<{ cleanerId: string; cleanerName: string; score: number; reasons: string[] }>;
  }> = [];

  for (let i = 1; i <= daysAhead; i += 1) {
    const candidate = new Date(base.getTime() + i * 24 * 3600_000);
    const dateKey = candidate.toISOString().slice(0, 10);
    const startTime = job.startTime || job.property.defaultCheckoutTime || "10:00";
    const dueTime = job.dueTime || "15:00";
    const overlaps = await db.job.count({
      where: {
        propertyId: job.propertyId,
        scheduledDate: {
          gte: new Date(`${dateKey}T00:00:00.000Z`),
          lte: new Date(`${dateKey}T23:59:59.999Z`),
        },
        id: { not: job.id },
      },
    });
    if (overlaps > 0) continue;

    const cleanerSuggestions = await suggestAutoAssignment(jobId).catch(() => []);
    suggestions.push({
      date: dateKey,
      startTime,
      dueTime,
      reason: `No property clash on ${dateKey}`,
      cleanerSuggestions: cleanerSuggestions.slice(0, 3),
    });
    if (suggestions.length >= 5) break;
  }

  return {
    jobId: job.id,
    propertyName: job.property.name,
    currentDate: toDateKey(job.scheduledDate),
    suggestions,
  };
}

export async function applyReschedule(input: {
  jobId: string;
  date: string;
  startTime?: string | null;
  dueTime?: string | null;
  userId: string;
  reason?: string | null;
}) {
  const date = parseDateOnly(input.date);
  if (!date) throw new Error("Invalid date.");
  const job = await db.job.findUnique({ where: { id: input.jobId } });
  if (!job) throw new Error("Job not found.");
  const updated = await db.job.update({
    where: { id: input.jobId },
    data: {
      scheduledDate: date,
      startTime: input.startTime !== undefined ? input.startTime || null : job.startTime,
      dueTime: input.dueTime !== undefined ? input.dueTime || null : job.dueTime,
      internalNotes: [job.internalNotes || "", input.reason ? `Reschedule reason: ${input.reason}` : ""]
        .filter(Boolean)
        .join("\n"),
    },
  });
  await db.auditLog.create({
    data: {
      userId: input.userId,
      jobId: job.id,
      action: "JOB_RESCHEDULE_ASSISTANT_APPLY",
      entity: "Job",
      entityId: job.id,
      before: {
        scheduledDate: job.scheduledDate,
        startTime: job.startTime,
        dueTime: job.dueTime,
      } as any,
      after: {
        scheduledDate: updated.scheduledDate,
        startTime: updated.startTime,
        dueTime: updated.dueTime,
        reason: input.reason ?? null,
      } as any,
    },
  });
  return updated;
}

export async function getBranchContext(branchId: string | null | undefined) {
  if (!branchId) return { branch: null, propertyIds: null as string[] | null };
  const [branch, propertyIds] = await Promise.all([
    getBranchById(branchId),
    resolveBranchPropertyIds(branchId),
  ]);
  return { branch, propertyIds };
}
