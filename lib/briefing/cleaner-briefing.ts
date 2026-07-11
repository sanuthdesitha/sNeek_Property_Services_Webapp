/**
 * Cleaner daily-briefing data assembler.
 *
 * Server-side, scoped to ONE signed-in cleaner (own active assignments only).
 * Every section is assembled inside a single Promise.all with a per-section
 * try/catch that degrades to null, so a single failing query never sinks the
 * whole briefing. The result is a typed `CleanerBriefing` plus a natural
 * spoken script for the voiceover.
 *
 * No schema changes — reads only existing models. Money math reuses the
 * canonical `computeCleanerPay` (never re-derived here).
 */
import { format } from "date-fns";
import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes, resolveRuleTime } from "@/lib/jobs/meta";
import { computeCleanerPay } from "@/lib/finance/job-money";
import {
  sydneyTodayKey,
  sydneyDayStart,
  sydneyDayEndInclusive,
  addDaysToKey,
} from "@/lib/time/sydney-range";
import { getBriefingWeather } from "@/lib/briefing/weather";
import { computeFinishTime, formatClock, type FinishTimeStop } from "@/lib/briefing/finish-time";
import { getCleanerCommonMistakes } from "@/lib/workforce/mistakes";
import { buildSpokenScript } from "@/lib/briefing/spoken-script";
import type {
  BriefingComplaints,
  BriefingDay,
  BriefingEarnings,
  BriefingFinishTime,
  BriefingJob,
  BriefingJobsOverview,
  BriefingLaundry,
  BriefingLowStock,
  BriefingReminders,
  BriefingSpecialRequests,
  BriefingWatchOuts,
  BriefingWeather,
  CleanerBriefing,
} from "@/lib/briefing/types";

function prettyJobType(jobType: string): string {
  return jobType
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function parseHHmm(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

const LATE_CHECKOUT_MIN = 10 * 60; // starts after ~10:00 → late checkout
const PEAK_START = 7 * 60 + 30; // 07:30
const PEAK_END = 9 * 60 + 30; // 09:30

type LoadedJob = {
  id: string;
  jobType: string;
  status: JobStatus;
  startTime: string | null;
  dueTime: string | null;
  estimatedHours: number | null;
  internalNotes: string | null;
  propertyId: string;
  property: {
    name: string;
    suburb: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  assignments: Array<{ userId: string; payRate: number | null; removedAt: Date | null }>;
};

/** Schedule order: earliest start first (nulls last), then earliest due. */
function scheduleSort(a: LoadedJob, b: LoadedJob): number {
  const as = parseHHmm(a.startTime);
  const bs = parseHHmm(b.startTime);
  if (as != null && bs != null && as !== bs) return as - bs;
  if (as != null && bs == null) return -1;
  if (as == null && bs != null) return 1;
  const ad = parseHHmm(a.dueTime);
  const bd = parseHHmm(b.dueTime);
  if (ad != null && bd != null) return ad - bd;
  return 0;
}

export async function assembleCleanerBriefing(input: {
  cleanerId: string;
  cleanerName: string;
  day: BriefingDay;
}): Promise<CleanerBriefing> {
  const { cleanerId, cleanerName, day } = input;
  const todayKey = sydneyTodayKey();
  const dayKey = day === "tomorrow" ? addDaysToKey(todayKey, 1) : todayKey;
  const dayStart = sydneyDayStart(dayKey);
  const dayEnd = sydneyDayEndInclusive(dayKey);
  const dayOffset = day === "tomorrow" ? 1 : 0;

  const dateLabel = format(new Date(`${dayKey}T12:00:00`), "EEEE · d MMMM");

  // ── Base query: the cleaner's own jobs for the day (active assignments) ──
  let loaded: LoadedJob[] = [];
  try {
    loaded = (await db.job.findMany({
      where: {
        assignments: { some: { userId: cleanerId, removedAt: null } },
        scheduledDate: { gte: dayStart, lte: dayEnd },
        status: { notIn: [JobStatus.COMPLETED, JobStatus.INVOICED] },
      },
      select: {
        id: true,
        jobType: true,
        status: true,
        startTime: true,
        dueTime: true,
        estimatedHours: true,
        internalNotes: true,
        propertyId: true,
        property: { select: { name: true, suburb: true, latitude: true, longitude: true } },
        assignments: { select: { userId: true, payRate: true, removedAt: true } },
      },
    })) as LoadedJob[];
  } catch {
    loaded = [];
  }
  loaded.sort(scheduleSort);

  const jobIds = loaded.map((j) => j.id);
  const propertyIds = Array.from(new Set(loaded.map((j) => j.propertyId)));
  const metaById = new Map(loaded.map((j) => [j.id, parseJobInternalNotes(j.internalNotes)]));

  // Fetch settings + user hourly rate up-front (needed by earnings).
  const [settings, cleanerUser] = await Promise.all([
    getAppSettings().catch(() => null),
    db.user.findUnique({ where: { id: cleanerId }, select: { hourlyRate: true } }).catch(() => null),
  ]);

  // ── Section assembly (all null-safe) ─────────────────────────────────────
  const [
    jobsOverview,
    specialRequests,
    lowStock,
    laundry,
    weatherData,
    earnings,
    finishTime,
    watchOuts,
    complaints,
    reminders,
  ] = await Promise.all([
    // 1. Jobs overview
    (async (): Promise<BriefingJobsOverview | null> => {
      if (loaded.length === 0) return { count: 0, jobs: [] };
      const jobs: BriefingJob[] = loaded.map((j) => {
        const meta = metaById.get(j.id);
        const earlyRule = meta ? resolveRuleTime(meta.earlyCheckin) : undefined;
        const lateRule = meta ? resolveRuleTime(meta.lateCheckout) : undefined;
        const startMin = parseHHmm(j.startTime);
        return {
          id: j.id,
          propertyName: j.property.name,
          suburb: j.property.suburb,
          jobType: prettyJobType(j.jobType),
          startTime: j.startTime,
          dueTime: j.dueTime,
          estimatedHours: j.estimatedHours,
          status: j.status,
          earlyCheckin: Boolean(earlyRule) || Boolean(j.dueTime),
          lateCheckout: Boolean(lateRule) || (startMin != null && startMin > LATE_CHECKOUT_MIN),
        };
      });
      return { count: jobs.length, jobs };
    })().catch(() => null),

    // 2. Special requests & tasks
    (async (): Promise<BriefingSpecialRequests | null> => {
      const items: string[] = [];
      for (const j of loaded) {
        const meta = metaById.get(j.id);
        for (const add of meta?.additionals ?? []) {
          if (add.label) items.push(add.label);
        }
      }
      if (jobIds.length > 0) {
        const tasks = await db.jobTask.findMany({
          where: {
            jobId: { in: jobIds },
            source: "CLIENT",
            approvalStatus: "APPROVED",
          },
          select: { title: true },
        });
        for (const t of tasks) if (t.title?.trim()) items.push(t.title.trim());
      }
      const unique = Array.from(new Set(items.map((s) => s.trim()).filter(Boolean)));
      return unique.length > 0 ? { items: unique } : null;
    })().catch(() => null),

    // 3. Critical low stock at the day's properties
    (async (): Promise<BriefingLowStock | null> => {
      if (propertyIds.length === 0) return null;
      const rows = await db.propertyStock.findMany({
        where: {
          propertyId: { in: propertyIds },
          onHand: { lte: db.propertyStock.fields.reorderThreshold },
        },
        include: {
          item: { select: { name: true, unit: true } },
          property: { select: { name: true } },
        },
      });
      const critical = rows
        .filter((r) => Number(r.onHand) <= 0 || Number(r.onHand) < Math.max(1, Number(r.reorderThreshold)))
        .sort((a, b) => Number(a.onHand) - Number(b.onHand))
        .map((r) => ({
          property: r.property.name,
          item: r.item.name,
          left: Number(r.onHand),
          unit: r.item.unit,
        }));
      if (critical.length === 0) return null;
      return { items: critical.slice(0, 6), moreCount: Math.max(0, critical.length - 6) };
    })().catch(() => null),

    // 4. Laundry summary
    (async (): Promise<BriefingLaundry | null> => {
      if (jobIds.length === 0) return null;
      const tasks = await db.laundryTask.findMany({
        where: {
          jobId: { in: jobIds },
          status: { notIn: ["DROPPED", "SKIPPED_PICKUP"] },
        },
        select: { property: { select: { name: true } } },
      });
      if (tasks.length === 0) return null;
      const properties = Array.from(new Set(tasks.map((t) => t.property.name)));
      const line =
        `${tasks.length} laundry ${tasks.length === 1 ? "task" : "tasks"} — make sure fresh linen is ready at ` +
        `${properties.length === 1 ? properties[0] : properties.slice(0, -1).join(", ") + " and " + properties[properties.length - 1]}.`;
      return { totalTasks: tasks.length, properties, line };
    })().catch(() => null),

    // 5. Weather (keyless)
    (async (): Promise<BriefingWeather | null> => {
      const first = loaded.find((j) => j.property.latitude != null && j.property.longitude != null);
      return getBriefingWeather({
        latitude: first?.property.latitude ?? null,
        longitude: first?.property.longitude ?? null,
        dayOffset,
      });
    })().catch(() => null),

    // 6. Expected earnings
    (async (): Promise<BriefingEarnings | null> => {
      if (loaded.length === 0 || !settings) return null;
      let total = 0;
      let rateMissing = false;
      for (const j of loaded) {
        const activeCount = j.assignments.filter((a) => !a.removedAt).length || 1;
        const mine = j.assignments.find((a) => a.userId === cleanerId && !a.removedAt);
        const meta = metaById.get(j.id);
        const pay = computeCleanerPay(
          { jobType: j.jobType as any, estimatedHours: j.estimatedHours },
          { payRate: mine?.payRate ?? null, userHourlyRate: cleanerUser?.hourlyRate ?? null },
          { cleanerJobHourlyRates: settings.cleanerJobHourlyRates },
          {
            cleanerId,
            activeAssignmentCount: activeCount,
            customPayout: meta?.cleanerPayouts?.[cleanerId],
            transportAllowance: meta?.transportAllowances?.[cleanerId],
          }
        );
        total += pay.total;
        if (pay.rateMissing) rateMissing = true;
      }
      return { amount: Number(total.toFixed(2)), label: "estimated", rateMissing };
    })().catch(() => null),

    // 7. Expected finish time
    (async (): Promise<BriefingFinishTime | null> => {
      if (loaded.length === 0) return null;
      const stops: FinishTimeStop[] = loaded.map((j) => ({
        startTime: j.startTime,
        estimatedHours: j.estimatedHours,
        latitude: j.property.latitude,
        longitude: j.property.longitude,
      }));
      const result = computeFinishTime(stops, "driving");
      if (!result) return null;
      return {
        startTime: formatClock(result.startMinutes),
        finishTime: `~${formatClock(result.finishMinutes)}`,
        totalHours: result.totalHours,
        assumedStart: result.assumedStart,
        label: "estimate",
      };
    })().catch(() => null),

    // 8. Watch-outs (personal QA mistakes)
    (async (): Promise<BriefingWatchOuts | null> => {
      const agg = await getCleanerCommonMistakes(cleanerId, 90);
      return agg.items.length > 0 ? { items: agg.items.slice(0, 5) } : null;
    })().catch(() => null),

    // 10. Previous complaints (last 60 days) on the day's properties
    (async (): Promise<BriefingComplaints | null> => {
      if (propertyIds.length === 0) return null;
      const since = new Date(Date.now() - 60 * 86_400_000);
      const [feedback, cases] = await Promise.all([
        db.jobFeedback
          .findMany({
            where: {
              submittedAt: { gte: since },
              rating: { lte: 3 },
              NOT: { comment: null },
              job: { propertyId: { in: propertyIds } },
            },
            select: { comment: true, submittedAt: true, job: { select: { property: { select: { name: true } } } } },
            orderBy: { submittedAt: "desc" },
            take: 5,
          })
          .catch(() => []),
        db.issueTicket
          .findMany({
            where: {
              propertyId: { in: propertyIds },
              createdAt: { gte: since },
              caseType: { in: ["COMPLAINT", "CLIENT"] },
            },
            select: { title: true, createdAt: true, property: { select: { name: true } } },
            orderBy: { createdAt: "desc" },
            take: 5,
          })
          .catch(() => []),
      ]);
      const merged = [
        ...feedback.map((f) => ({
          property: f.job?.property?.name ?? "Property",
          text: (f.comment ?? "").trim(),
          when: f.submittedAt ?? since,
        })),
        ...cases.map((c) => ({
          property: c.property?.name ?? "Property",
          text: (c.title ?? "").trim(),
          when: c.createdAt,
        })),
      ]
        .filter((x) => x.text)
        .sort((a, b) => b.when.getTime() - a.when.getTime())
        .slice(0, 3)
        .map((x) => ({
          property: x.property,
          text: x.text.length > 120 ? `${x.text.slice(0, 117)}…` : x.text,
          date: format(x.when, "d MMM"),
        }));
      return merged.length > 0 ? { items: merged } : null;
    })().catch(() => null),

    // 9. Reminders (device batteries + expiring documents)
    (async (): Promise<BriefingReminders | null> => {
      const deviceLine =
        propertyIds.length > 0
          ? "Check/replace Ring camera & Minut device batteries where fitted."
          : null;
      let expiringDocuments: string[] = [];
      try {
        const soon = new Date(Date.now() + 30 * 86_400_000);
        const docs = await db.staffDocument.findMany({
          where: { userId: cleanerId, expiresAt: { not: null, lte: soon, gte: new Date() } },
          select: { title: true },
          take: 5,
        });
        expiringDocuments = docs.map((d) => d.title).filter(Boolean);
      } catch {
        expiringDocuments = [];
      }
      if (!deviceLine && expiringDocuments.length === 0) return null;
      return { deviceLine, expiringDocuments };
    })().catch(() => null),
  ]);

  // Attach the heuristic traffic-buffer line to the weather section (or create a
  // weather stub carrying only the traffic advice when the fetch failed).
  let weather: BriefingWeather | null = weatherData ?? null;
  const firstStartMin = parseHHmm(loaded[0]?.startTime);
  const trafficBuffer =
    firstStartMin != null && firstStartMin >= PEAK_START && firstStartMin <= PEAK_END
      ? "Allow extra travel time between 7:30 and 9:30 for peak traffic"
      : null;
  if (trafficBuffer) {
    if (weather) {
      weather = { ...weather, trafficBuffer };
    } else {
      weather = { summary: "", wetWeatherGear: false, precipProbability: null, trafficBuffer };
    }
  }

  const base: Omit<CleanerBriefing, "spokenScript"> = {
    day,
    dateLabel,
    greetingName: cleanerName,
    generatedAt: new Date().toISOString(),
    jobsOverview: jobsOverview ?? null,
    specialRequests: specialRequests ?? null,
    lowStock: lowStock ?? null,
    laundry: laundry ?? null,
    weather,
    earnings: earnings ?? null,
    finishTime: finishTime ?? null,
    watchOuts: watchOuts ?? null,
    reminders: reminders ?? null,
    complaints: complaints ?? null,
  };

  const spokenScript = buildSpokenScript(base, day);
  return { ...base, spokenScript };
}
