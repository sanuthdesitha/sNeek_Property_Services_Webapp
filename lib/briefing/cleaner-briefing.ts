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
import { JobStatus, JobAssignmentResponseStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { parseJobInternalNotes, resolveRuleTime } from "@/lib/jobs/meta";
import { computeCleanerPay } from "@/lib/finance/job-money";
import {
  sydneyTodayKey,
  sydneyDayStart,
  sydneyDayEndInclusive,
  addDaysToKey,
  weekMondayKey,
} from "@/lib/time/sydney-range";
import { getBriefingWeather } from "@/lib/briefing/weather";
import { computeFinishTime, formatClock, type FinishTimeStop } from "@/lib/briefing/finish-time";
import { getEtaMinutes, type EtaMode } from "@/lib/jobs/eta";
import { haversine } from "@/lib/gps/distance";
import { getCleanerCommonMistakes, prettifyFieldId } from "@/lib/workforce/mistakes";
import {
  getCleanerRecurringIssues,
  getPropertyRecurringIssues,
} from "@/lib/accountability/patterns";
import { buildSpokenScript } from "@/lib/briefing/spoken-script";
import type {
  BriefingAcceptGate,
  BriefingAccessNotes,
  BriefingAccessStop,
  BriefingComplaints,
  BriefingDay,
  BriefingEarnings,
  BriefingFinishTime,
  BriefingJob,
  BriefingJobsOverview,
  BriefingLastVisit,
  BriefingLastVisitItem,
  BriefingLaundry,
  BriefingLowStock,
  BriefingNewProperties,
  BriefingNewPropertyItem,
  BriefingPriorityItem,
  BriefingPriorityWatch,
  BriefingRecurringIssues,
  BriefingReminders,
  BriefingSpecialRequests,
  BriefingSupplies,
  BriefingSupplyItem,
  BriefingTravelLeg,
  BriefingTravelPlan,
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

const PEAK_START = 7 * 60 + 30; // 07:30
const PEAK_END = 9 * 60 + 30; // 09:30
const TRAVEL_BUFFER_MIN = 10; // pack-down/settle buffer added to each leave-by
const URBAN_SPEED_KMH = 30; // haversine fallback driving speed
const HEAT_ADVISORY_C = 32; // max temp that warrants a heat advisory

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
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    imageUrl: string | null;
    accessCode: string | null;
    alarmCode: string | null;
    keyLocation: string | null;
    accessNotes: string | null;
    accessInfo: unknown;
    accessGuide: unknown;
    features: unknown;
  };
  assignments: Array<{ userId: string; payRate: number | null; removedAt: Date | null }>;
};

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Format minutes-past-midnight as a 24h HH:mm clock (matches schedule strip). */
function fmtHHmm(minutes: number): string {
  let m = Math.round(minutes) % (24 * 60);
  if (m < 0) m += 24 * 60;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Concise per-stop access & quirks (parking, lockbox, key, alarm, pet). */
function buildAccessItems(p: LoadedJob["property"]): string[] {
  const items: string[] = [];
  const info = asRecord(p.accessInfo);
  const parking = nonEmpty(info?.parking);
  if (parking) items.push(`Parking: ${parking}`);
  const lockbox = nonEmpty(info?.lockbox);
  if (lockbox) items.push(`Lockbox: ${lockbox}`);
  if (nonEmpty(p.keyLocation)) items.push(`Key: ${p.keyLocation!.trim()}`);
  if (nonEmpty(p.accessCode)) items.push(`Entry code: ${p.accessCode!.trim()}`);
  if (nonEmpty(p.alarmCode)) items.push(`Alarm code: ${p.alarmCode!.trim()}`);
  const features = asRecord(p.features);
  if (features?.petFriendly === true || features?.pet === true) {
    items.push("Pet on site — mind doors and gates.");
  }
  const note =
    nonEmpty(p.accessNotes) ??
    nonEmpty(info?.accessNotesSummary) ??
    nonEmpty(info?.instructions) ??
    nonEmpty(info?.other);
  if (note) items.push(note.length > 140 ? `${note.slice(0, 137)}…` : note);
  // Fall back to the rich access guide when the columns/json gave nothing.
  if (items.length === 0 && Array.isArray(p.accessGuide)) {
    for (const raw of p.accessGuide as unknown[]) {
      const g = asRecord(raw);
      const label = nonEmpty(g?.label);
      const instructions = nonEmpty(g?.instructions);
      if (label && instructions) items.push(`${label}: ${instructions.length > 100 ? instructions.slice(0, 97) + "…" : instructions}`);
      if (items.length >= 3) break;
    }
  }
  return Array.from(new Set(items)).slice(0, 5);
}

function accessGuideHasImages(accessGuide: unknown): boolean {
  if (!Array.isArray(accessGuide)) return false;
  return (accessGuide as unknown[]).some((raw) => {
    const g = asRecord(raw);
    return Array.isArray(g?.images) && (g!.images as unknown[]).length > 0;
  });
}

const SUPPLY_RULES: Array<{ test: RegExp; item: string }> = [
  { test: /carpet|steam|mattress|upholstery/, item: "Carpet/steam cleaner" },
  { test: /oven/, item: "Oven cleaning kit" },
  { test: /window|glass/, item: "Window/glass kit" },
  { test: /fridge/, item: "Fridge cleaning supplies" },
  { test: /wall/, item: "Wall-wash sponges" },
  { test: /bbq|barbeque|barbecue/, item: "BBQ cleaning kit" },
  { test: /balcon|outdoor|pressure|patio|garden/, item: "Outdoor/pressure gear" },
  { test: /pet|hair/, item: "Pet-hair brush" },
];

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

  // ── Base query: the cleaner's own ACCEPTED jobs for the day ──────────────
  // Accept gate: the normal briefing only covers assignments the cleaner has
  // ACCEPTED. PENDING (unaccepted) assignments are surfaced separately so the
  // cleaner is told to accept them first.
  const propertySelect = {
    name: true,
    suburb: true,
    address: true,
    latitude: true,
    longitude: true,
    bedrooms: true,
    bathrooms: true,
    imageUrl: true,
    accessCode: true,
    alarmCode: true,
    keyLocation: true,
    accessNotes: true,
    accessInfo: true,
    accessGuide: true,
    features: true,
  } as const;

  let loaded: LoadedJob[] = [];
  try {
    loaded = (await db.job.findMany({
      where: {
        assignments: {
          some: { userId: cleanerId, removedAt: null, responseStatus: JobAssignmentResponseStatus.ACCEPTED },
        },
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
        property: { select: propertySelect },
        assignments: { select: { userId: true, payRate: true, removedAt: true } },
      },
    })) as LoadedJob[];
  } catch {
    loaded = [];
  }
  loaded.sort(scheduleSort);

  // Pending (unaccepted) assignments for the same day → the accept-gate card.
  let acceptGate: BriefingAcceptGate | null = null;
  try {
    const pending = await db.job.findMany({
      where: {
        assignments: {
          some: { userId: cleanerId, removedAt: null, responseStatus: JobAssignmentResponseStatus.PENDING },
        },
        scheduledDate: { gte: dayStart, lte: dayEnd },
        status: { notIn: [JobStatus.COMPLETED, JobStatus.INVOICED] },
      },
      select: {
        id: true,
        jobType: true,
        startTime: true,
        property: { select: { name: true, suburb: true } },
      },
    });
    pending.sort((a, b) => {
      const as = parseHHmm(a.startTime);
      const bs = parseHHmm(b.startTime);
      if (as != null && bs != null) return as - bs;
      if (as != null) return -1;
      if (bs != null) return 1;
      return 0;
    });
    if (pending.length > 0) {
      acceptGate = {
        items: pending.map((j) => ({
          id: j.id,
          propertyName: j.property.name,
          suburb: j.property.suburb,
          jobType: prettyJobType(j.jobType),
          startTime: j.startTime,
        })),
      };
    }
  } catch {
    acceptGate = null;
  }

  const jobIds = loaded.map((j) => j.id);
  const propertyIds = Array.from(new Set(loaded.map((j) => j.propertyId)));
  const metaById = new Map(loaded.map((j) => [j.id, parseJobInternalNotes(j.internalNotes)]));

  // Fetch settings + user hourly rate up-front (needed by earnings).
  const [settings, cleanerUser] = await Promise.all([
    getAppSettings().catch(() => null),
    db.user
      .findUnique({
        where: { id: cleanerId },
        select: {
          hourlyRate: true,
          latitude: true,
          longitude: true,
          preferredTransport: true,
          address: true,
        },
      })
      .catch(() => null),
  ]);

  // The cleaner's chosen travel mode (Google-style lowercase: driving/walking/
  // transit/bicycling), used for BOTH the first-leg ETA and the leg-to-leg plan.
  const preferredMode = String(cleanerUser?.preferredTransport ?? "DRIVING").toLowerCase() as EtaMode;

  // First-leg travel: from the cleaner's home to the first accepted job, so the
  // briefing can lead with "how long to get there". Keyless haversine fallback.
  let firstLegTravel: { minutes: number; mode: string } | null = null;
  const firstJobProp = loaded[0]?.property;
  if (
    cleanerUser?.latitude != null &&
    cleanerUser?.longitude != null &&
    firstJobProp &&
    firstJobProp.latitude != null &&
    firstJobProp.longitude != null
  ) {
    let minutes = await getEtaMinutes({
      fromLat: cleanerUser.latitude,
      fromLng: cleanerUser.longitude,
      toLat: firstJobProp.latitude,
      toLng: firstJobProp.longitude,
      toAddress: firstJobProp.address ?? undefined,
      mode: preferredMode,
    }).catch(() => null);
    if (minutes == null) {
      const km =
        haversine(cleanerUser.latitude, cleanerUser.longitude, firstJobProp.latitude, firstJobProp.longitude) /
        1000;
      minutes = Math.max(5, Math.round((km / URBAN_SPEED_KMH) * 60));
    }
    firstLegTravel = { minutes, mode: preferredMode };
  }

  // Sum this cleaner's pay across a set of jobs (reuses the canonical pay math).
  type PayJob = {
    jobType: string;
    estimatedHours: number | null;
    internalNotes: string | null;
    assignments: Array<{ userId: string; payRate: number | null; removedAt: Date | null }>;
  };
  const paySelect = {
    jobType: true,
    estimatedHours: true,
    internalNotes: true,
    assignments: { select: { userId: true, payRate: true, removedAt: true } },
  } as const;
  function sumCleanerPay(jobs: PayJob[]): number {
    if (!settings) return 0;
    let total = 0;
    for (const j of jobs) {
      const activeCount = j.assignments.filter((a) => !a.removedAt).length || 1;
      const mine = j.assignments.find((a) => a.userId === cleanerId && !a.removedAt);
      const meta = parseJobInternalNotes(j.internalNotes);
      const pay = computeCleanerPay(
        { jobType: j.jobType as any, estimatedHours: j.estimatedHours },
        { payRate: mine?.payRate ?? null, userHourlyRate: cleanerUser?.hourlyRate ?? null },
        { cleanerJobHourlyRates: settings.cleanerJobHourlyRates },
        {
          cleanerId,
          activeAssignmentCount: activeCount,
          customPayout: meta.cleanerPayouts?.[cleanerId],
          transportAllowance: meta.transportAllowances?.[cleanerId],
        }
      );
      total += pay.total;
    }
    return total;
  }

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
        return {
          id: j.id,
          propertyName: j.property.name,
          suburb: j.property.suburb,
          jobType: prettyJobType(j.jobType),
          startTime: j.startTime,
          dueTime: j.dueTime,
          estimatedHours: j.estimatedHours,
          status: j.status,
          // Only flag when an actual early-check-in / late-checkout RULE exists —
          // the mere presence of a dueTime (or a late-ish start) is not a rule.
          earlyCheckin: Boolean(earlyRule),
          lateCheckout: Boolean(lateRule),
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
        // Mirror the workspace's "important requests": approved CLIENT tasks +
        // ADMIN tasks, and additionally carry forward the previous cleaner's
        // handover notes (CARRY_FORWARD) so nothing is dropped between visits.
        const tasks = await db.jobTask.findMany({
          where: {
            jobId: { in: jobIds },
            OR: [
              { source: "CLIENT", approvalStatus: "APPROVED" },
              { source: "ADMIN" },
              { source: "CARRY_FORWARD" },
            ],
          },
          select: { title: true, source: true },
        });
        for (const t of tasks) {
          const title = t.title?.trim();
          if (!title) continue;
          items.push(t.source === "CARRY_FORWARD" ? `Handover: ${title}` : title);
        }
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

    // 6. Expected earnings (+ transport allowance, + week-to-date vs last week)
    (async (): Promise<BriefingEarnings | null> => {
      if (loaded.length === 0 || !settings) return null;
      let total = 0;
      let transport = 0;
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
        transport += pay.transportAllowance;
        if (pay.rateMissing) rateMissing = true;
      }
      const out: BriefingEarnings = { amount: Number(total.toFixed(2)), label: "estimated", rateMissing };
      if (transport > 0) out.transportAllowance = Number(transport.toFixed(2));

      // ⑦ Week-to-date (Mon → this day) vs the whole previous week — best-effort.
      try {
        const weekStartKey = weekMondayKey(dayKey);
        const weekStart = sydneyDayStart(weekStartKey);
        const lastWeekStart = sydneyDayStart(addDaysToKey(weekStartKey, -7));
        const lastWeekEnd = sydneyDayEndInclusive(addDaysToKey(weekStartKey, -1));
        const [wtdJobs, lastWeekJobs] = await Promise.all([
          db.job.findMany({
            where: {
              assignments: { some: { userId: cleanerId, removedAt: null } },
              scheduledDate: { gte: weekStart, lte: dayEnd },
            },
            select: paySelect,
          }),
          db.job.findMany({
            where: {
              assignments: { some: { userId: cleanerId, removedAt: null } },
              scheduledDate: { gte: lastWeekStart, lte: lastWeekEnd },
            },
            select: paySelect,
          }),
        ]);
        out.weekToDate = Number(sumCleanerPay(wtdJobs as PayJob[]).toFixed(2));
        out.lastWeek = Number(sumCleanerPay(lastWeekJobs as PayJob[]).toFixed(2));
      } catch {
        /* leave WTD/last-week undefined */
      }
      return out;
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

  // ── Intelligence sections (all null-safe, degrade per-datum) ─────────────
  const [travelAndPriority, accessNotes, lastVisit, newProperties] = await Promise.all([
    // ① Travel plan + ⑧ turnaround/priority watch (share the ETA computation).
    (async (): Promise<{ travelPlan: BriefingTravelPlan | null; priorityWatch: BriefingPriorityWatch | null }> => {
      const legs: BriefingTravelLeg[] = [];
      for (let i = 0; i < loaded.length - 1; i++) {
        const a = loaded[i];
        const b = loaded[i + 1];
        const aLat = a.property.latitude;
        const aLng = a.property.longitude;
        const bLat = b.property.latitude;
        const bLng = b.property.longitude;
        let eta: number | null = null;
        let estimated = false;
        if (aLat != null && aLng != null && bLat != null && bLng != null) {
          eta = await getEtaMinutes({
            fromLat: aLat,
            fromLng: aLng,
            toLat: bLat,
            toLng: bLng,
            mode: preferredMode,
          }).catch(() => null);
          if (eta == null) {
            const km = haversine(aLat, aLng, bLat, bLng) / 1000;
            eta = Math.max(5, Math.round((km / URBAN_SPEED_KMH) * 60));
            estimated = true;
          }
        }
        const nextStartMin = parseHHmm(b.startTime);
        const leaveBy = nextStartMin != null && eta != null ? fmtHHmm(nextStartMin - eta - TRAVEL_BUFFER_MIN) : null;
        const aStartMin = parseHHmm(a.startTime);
        const aHours = typeof a.estimatedHours === "number" && a.estimatedHours > 0 ? a.estimatedHours : 2;
        const tight =
          aStartMin != null && nextStartMin != null && eta != null
            ? aStartMin + aHours * 60 + eta > nextStartMin
            : false;
        legs.push({
          fromProperty: a.property.name,
          toProperty: b.property.name,
          etaMinutes: eta,
          estimated,
          nextStart: b.startTime,
          leaveBy,
          tight,
        });
      }
      const travelPlan = legs.length > 0 ? { legs } : null;

      const watch: BriefingPriorityItem[] = [];
      for (const leg of legs) {
        if (leg.tight) {
          watch.push({
            propertyName: leg.toProperty,
            reason: `Tight turnaround from ${leg.fromProperty}${leg.etaMinutes != null ? ` (~${leg.etaMinutes} min drive)` : ""} — leave promptly.`,
            kind: "tight-turnaround",
          });
        }
      }
      for (const j of loaded) {
        const s = parseHHmm(j.startTime);
        const d = parseHHmm(j.dueTime);
        const h = typeof j.estimatedHours === "number" && j.estimatedHours > 0 ? j.estimatedHours : 2;
        if (s != null && d != null && s + h * 60 > d) {
          watch.push({
            propertyName: j.property.name,
            reason: `Due by ${j.dueTime} but ~${h}h allocated — start on time to make the deadline.`,
            kind: "due-time",
          });
        }
      }
      const priorityWatch = watch.length > 0 ? { items: watch.slice(0, 6) } : null;
      return { travelPlan, priorityWatch };
    })().catch(() => ({ travelPlan: null, priorityWatch: null })),

    // ② Access & quirks per stop.
    (async (): Promise<BriefingAccessNotes | null> => {
      const stops: BriefingAccessStop[] = [];
      const seenProp = new Set<string>();
      for (const j of loaded) {
        if (seenProp.has(j.propertyId)) continue;
        seenProp.add(j.propertyId);
        const items = buildAccessItems(j.property);
        if (items.length > 0) stops.push({ propertyName: j.property.name, items });
      }
      return stops.length > 0 ? { stops } : null;
    })().catch(() => null),

    // ③ Last-visit context — previous QA outcome per property.
    (async (): Promise<BriefingLastVisit | null> => {
      if (propertyIds.length === 0) return null;
      const reviews = await db.qAReview.findMany({
        where: { job: { propertyId: { in: propertyIds }, scheduledDate: { lt: dayStart } } },
        select: {
          score: true,
          passed: true,
          flags: true,
          createdAt: true,
          job: {
            select: {
              propertyId: true,
              scheduledDate: true,
              reworkReason: true,
              property: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 60,
      });
      const byProp = new Map<string, BriefingLastVisitItem>();
      for (const r of reviews) {
        const pid = r.job?.propertyId;
        if (!pid || byProp.has(pid)) continue; // latest per property (desc order)
        const flags = Array.isArray(r.flags)
          ? (r.flags as unknown[])
              .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
              .slice(0, 3)
              .map((x) => prettifyFieldId(x))
          : [];
        const when = r.job?.scheduledDate ?? r.createdAt ?? null;
        byProp.set(pid, {
          propertyName: r.job?.property?.name ?? "Property",
          score: typeof r.score === "number" && Number.isFinite(r.score) ? r.score : null,
          passed: typeof r.passed === "boolean" ? r.passed : null,
          date: when ? format(when, "d MMM") : null,
          flags,
          reworkReason: nonEmpty(r.job?.reworkReason),
        });
      }
      // Order by today's schedule; keep only properties we actually visit today.
      const items = propertyIds.map((pid) => byProp.get(pid)).filter((x): x is BriefingLastVisitItem => !!x).slice(0, 5);
      return items.length > 0 ? { items } : null;
    })().catch(() => null),

    // ④ New-to-you — properties this cleaner has never worked before.
    (async (): Promise<BriefingNewProperties | null> => {
      if (propertyIds.length === 0) return null;
      const prior = await db.job.findMany({
        where: {
          propertyId: { in: propertyIds },
          assignments: { some: { userId: cleanerId, removedAt: null } },
          scheduledDate: { lt: dayStart },
        },
        select: { propertyId: true },
      });
      const seen = new Set(prior.map((j) => j.propertyId));
      const items: BriefingNewPropertyItem[] = [];
      const done = new Set<string>();
      for (const j of loaded) {
        if (seen.has(j.propertyId) || done.has(j.propertyId)) continue;
        done.add(j.propertyId);
        const meta = metaById.get(j.id);
        const hasRef =
          Boolean(j.property.imageUrl) ||
          Boolean(meta?.quoteReferenceImages && meta.quoteReferenceImages.length > 0) ||
          accessGuideHasImages(j.property.accessGuide);
        items.push({
          jobId: j.id,
          propertyName: j.property.name,
          suburb: j.property.suburb,
          bedrooms: typeof j.property.bedrooms === "number" ? j.property.bedrooms : null,
          bathrooms: typeof j.property.bathrooms === "number" ? j.property.bathrooms : null,
          hasReferencePhotos: hasRef,
        });
      }
      return items.length > 0 ? { items } : null;
    })().catch(() => null),
  ]);

  const travelPlan = travelAndPriority.travelPlan;
  const priorityWatch = travelAndPriority.priorityWatch;

  // Recurring-issue reminders (Phase 7a) — the cleaner's own repeating QA
  // categories plus any recurring issues at the day's properties. Read-time
  // computation over QaIssue; degrades to null on any failure.
  const recurringIssues: BriefingRecurringIssues | null = await (async () => {
    try {
      const [cleanerHits, propertyHitsLists] = await Promise.all([
        getCleanerRecurringIssues(cleanerId),
        Promise.all(propertyIds.map((pid) => getPropertyRecurringIssues(pid))),
      ]);
      const items: { label: string; detail: string }[] = [];
      const seen = new Set<string>();
      for (const h of cleanerHits) {
        if (seen.has(`c:${h.category}`)) continue;
        seen.add(`c:${h.category}`);
        items.push({
          label: h.label,
          detail: `Flagged ${h.count}× in your recent cleans — give it extra attention.`,
        });
      }
      const propByCategory = new Map<string, (typeof propertyHitsLists)[number][number]>();
      for (const list of propertyHitsLists) {
        for (const h of list) {
          if (!propByCategory.has(h.category) || h.count > propByCategory.get(h.category)!.count) {
            propByCategory.set(h.category, h);
          }
        }
      }
      for (const h of Array.from(propByCategory.values())) {
        if (seen.has(`p:${h.category}`)) continue;
        seen.add(`p:${h.category}`);
        items.push({
          label: h.label,
          detail: `Recurring at a property on today's run (${h.count}× recently) — double-check it.`,
        });
      }
      const capped = items.slice(0, 5);
      return capped.length > 0 ? { items: capped } : null;
    } catch {
      return null;
    }
  })();

  // ⑤ Supplies to bring — inferred from each job's extras + laundry (synchronous).
  const supplies: BriefingSupplies | null = (() => {
    const items: BriefingSupplyItem[] = [];
    const seen = new Set<string>();
    const push = (item: string, reason: string) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ item, reason });
    };
    for (const j of loaded) {
      const meta = metaById.get(j.id);
      for (const add of meta?.additionals ?? []) {
        const label = add.label?.trim();
        if (!label) continue;
        const l = label.toLowerCase();
        for (const rule of SUPPLY_RULES) {
          if (rule.test.test(l)) push(rule.item, `${label} at ${j.property.name}`);
        }
      }
    }
    // Laundry bags / fresh linen when the day carries laundry tasks.
    if (laundry && laundry.totalTasks > 0) {
      const where = laundry.properties.length > 0 ? laundry.properties.join(", ") : "your laundry stops";
      push("Laundry bags & fresh linen", `Linen expected at ${where}`);
    }
    return items.length > 0 ? { items } : null;
  })();

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

  // ⑥ Weather-aware advisories — rain/heat tied to travel + outdoor work.
  if (weather) {
    const advisories: string[] = [];
    const summaryLower = (weather.summary || "").toLowerCase();
    const rainy =
      weather.wetWeatherGear ||
      (weather.precipProbability != null && weather.precipProbability >= 40) ||
      /rain|shower|thunder|drizzle/.test(summaryLower);
    if (rainy) {
      advisories.push(
        "Wet weather likely — allow extra travel time and take care with balconies, windows and outdoor areas."
      );
    }
    // Parse the highest temperature from the summary, e.g. "… · 18–34°C".
    const temps = (weather.summary.match(/-?\d+/g) || []).map(Number).filter((n) => Number.isFinite(n));
    const maxTemp = temps.length > 0 ? Math.max(...temps) : null;
    if (maxTemp != null && maxTemp >= HEAT_ADVISORY_C) {
      advisories.push(`Hot day (up to ${maxTemp}°C) — hydrate, pace outdoor tasks and avoid the midday heat where you can.`);
    }
    if (advisories.length > 0) weather = { ...weather, advisories };
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
    recurringIssues: recurringIssues ?? null,
    acceptGate,
    firstLegTravel,
    travelPlan: travelPlan ?? null,
    accessNotes: accessNotes ?? null,
    lastVisit: lastVisit ?? null,
    newProperties: newProperties ?? null,
    supplies: supplies ?? null,
    priorityWatch: priorityWatch ?? null,
  };

  const spokenScript = buildSpokenScript(base, day);
  return { ...base, spokenScript };
}
