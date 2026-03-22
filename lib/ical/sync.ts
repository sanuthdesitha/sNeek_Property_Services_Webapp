import ICAL from "ical.js";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import { parseJobInternalNotes, serializeJobInternalNotes, type JobReservationContext } from "@/lib/jobs/meta";
import { classifySameDayCheckinPriority } from "@/lib/jobs/priority";
import { SyncStatus } from "@prisma/client";
import { addDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { DEFAULT_ICAL_SYNC_OPTIONS, parseIntegrationNotes, type IcalSyncOptions } from "@/lib/ical/options";

type SyncMode = "MANUAL" | "AUTO";

type ReservationState = {
  id: string;
  uid: string;
  startDate: string;
  endDate: string;
  summary: string | null;
  reservationCode: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
  guestProfileUrl: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  locationText: string | null;
  geoLat: number | null;
  geoLng: number | null;
  checkinAtLocal: string | null;
  checkoutAtLocal: string | null;
  source: string | null;
};

type JobState = {
  id: string;
  reservationId: string;
  scheduledDate: string;
  startTime: string | null;
  dueTime: string | null;
  estimatedHours: number | null;
  internalNotes: string | null;
  status: string;
  priorityBucket: number;
  priorityReason: string | null;
  sameDayCheckin: boolean;
  sameDayCheckinTime: string | null;
};

type ParsedFeedEvent = {
  uid: string;
  startDate: Date;
  endDate: Date;
  summary: string | null;
  reservationCode: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
  guestProfileUrl: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  locationText: string | null;
  geoLat: number | null;
  geoLng: number | null;
  checkinAtLocal: Date | null;
  checkoutAtLocal: Date | null;
};

type IcalSyncSnapshot = {
  reservations: Array<{
    id: string;
    uid: string;
    created: boolean;
    before: ReservationState | null;
    after: ReservationState;
  }>;
  jobs: Array<{
    id: string;
    reservationId: string;
    created: boolean;
    before: JobState | null;
    after: JobState;
  }>;
};

type IcalSyncSummary = {
  feedEvents: number;
  duplicateFeedEvents: number;
  ignoredPastEvents: number;
  reservationsCreated: number;
  reservationsUpdated: number;
  reservationsUnchanged: number;
  jobsCreated: number;
  jobsUpdated: number;
  jobsSkippedConflict: number;
  warnings: string[];
};

const TERMINAL_SYNC_JOB_STATUSES = new Set(["COMPLETED", "INVOICED"]);

export interface SyncPropertyIcalOptions {
  triggeredById?: string | null;
  mode?: SyncMode;
}

export interface UndoIcalSyncOptions {
  propertyId: string;
  runId: string;
  revertedById?: string | null;
}

function icalDateToUtcDateOnly(value: ICAL.Time): Date {
  return new Date(Date.UTC(value.year, value.month - 1, value.day));
}

function icalTimeToDate(value: ICAL.Time | null | undefined): Date | null {
  if (!value) return null;
  try {
    return value.toJSDate();
  } catch {
    return null;
  }
}

function extractLabelValueBlock(description: unknown) {
  if (typeof description !== "string" || !description.trim()) return new Map<string, string>();
  return description
    .split(/\r?\n/)
    .map((line) => (typeof line === "string" ? line.trim() : ""))
    .filter(Boolean)
    .reduce((map, line) => {
      const idx = line.indexOf(":");
      if (idx <= 0) return map;
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      if (key) map.set(key, value);
      return map;
    }, new Map<string, string>());
}

function normalizeEstimatedHours(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Number(value.toFixed(2));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Number(parsed.toFixed(2));
    }
  }
  return null;
}

function getPropertyDefaultEstimatedHours(accessInfo: unknown): number | null {
  if (!accessInfo || typeof accessInfo !== "object" || Array.isArray(accessInfo)) return null;
  return normalizeEstimatedHours((accessInfo as Record<string, unknown>).defaultCleanDurationHours);
}

function buildReservationContext(input: {
  summary?: string | null;
  reservationCode?: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
  guestProfileUrl?: string | null;
  adults?: number | null;
  children?: number | null;
  infants?: number | null;
  locationText?: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  checkinAtLocal?: Date | string | null;
  checkoutAtLocal?: Date | string | null;
}): JobReservationContext | undefined {
  const next: JobReservationContext = {};
  const assignString = (
    key:
      | "guestName"
      | "reservationCode"
      | "guestPhone"
      | "guestEmail"
      | "guestProfileUrl"
      | "locationText",
    value: unknown
  ) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed) next[key] = trimmed;
  };

  assignString("guestName", input.summary);
  assignString("reservationCode", input.reservationCode);
  assignString("guestPhone", input.guestPhone);
  assignString("guestEmail", input.guestEmail);
  assignString("guestProfileUrl", input.guestProfileUrl);
  assignString("locationText", input.locationText);

  const assignCount = (key: "adults" | "children" | "infants", value: number | null | undefined) => {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) next[key] = value;
  };
  assignCount("adults", input.adults);
  assignCount("children", input.children);
  assignCount("infants", input.infants);

  if (typeof input.geoLat === "number" && Number.isFinite(input.geoLat)) next.geoLat = Number(input.geoLat.toFixed(6));
  if (typeof input.geoLng === "number" && Number.isFinite(input.geoLng)) next.geoLng = Number(input.geoLng.toFixed(6));

  const toIso = (value: Date | string | null | undefined) => {
    if (!value) return undefined;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  };
  const checkinAtLocal = toIso(input.checkinAtLocal);
  const checkoutAtLocal = toIso(input.checkoutAtLocal);
  if (checkinAtLocal) next.checkinAtLocal = checkinAtLocal;
  if (checkoutAtLocal) next.checkoutAtLocal = checkoutAtLocal;

  return Object.keys(next).length > 0 ? next : undefined;
}

function mergeReservationContextIntoInternalNotes(
  currentInternalNotes: string | null | undefined,
  reservationContext: JobReservationContext | undefined
) {
  if (!reservationContext) return currentInternalNotes ?? undefined;
  const meta = parseJobInternalNotes(currentInternalNotes);
  return (
    serializeJobInternalNotes({
      ...meta,
      reservationContext,
    }) ?? undefined
  );
}

function nullableText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === "(no email alias available)") return null;
  if (trimmed.toLowerCase() === "(no url available)") return null;
  return trimmed;
}

function nullableInt(value: unknown) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
}

function parseGeo(value: unknown) {
  if (typeof value !== "string") return { geoLat: null, geoLng: null };
  const raw = value.trim();
  if (!raw || !raw.includes(";")) return { geoLat: null, geoLng: null };
  const [latRaw, lngRaw] = raw.split(";");
  const geoLat = Number(latRaw);
  const geoLng = Number(lngRaw);
  return {
    geoLat: Number.isFinite(geoLat) ? geoLat : null,
    geoLng: Number.isFinite(geoLng) ? geoLng : null,
  };
}

function toLocalTimeString(value: Date | null | undefined) {
  if (!value) return null;
  return value.toLocaleTimeString("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function parseFeedEvent(ev: ICAL.Event): ParsedFeedEvent | null {
  if (!ev.uid) return null;
  const descriptionMap = extractLabelValueBlock(ev.description);
  const geo = parseGeo((ev.component.getFirstPropertyValue("geo") as string | null | undefined) ?? null);
  return {
    uid: ev.uid,
    startDate: icalDateToUtcDateOnly(ev.startDate),
    endDate: icalDateToUtcDateOnly(ev.endDate),
    summary: ev.summary ?? null,
    reservationCode: nullableText(descriptionMap.get("reservation code") ?? null),
    guestPhone: nullableText(descriptionMap.get("phone") ?? null),
    guestEmail: nullableText(descriptionMap.get("email") ?? null),
    guestProfileUrl: nullableText(descriptionMap.get("profile") ?? null),
    adults: nullableInt(descriptionMap.get("adults") ?? null),
    children: nullableInt(descriptionMap.get("children") ?? null),
    infants: nullableInt(descriptionMap.get("infants") ?? null),
    locationText: nullableText((ev.location as string | null | undefined) ?? null),
    geoLat: geo.geoLat,
    geoLng: geo.geoLng,
    checkinAtLocal: icalTimeToDate(ev.startDate),
    checkoutAtLocal: icalTimeToDate(ev.endDate),
  };
}

function reservationState(row: {
  id: string;
  uid: string;
  startDate: Date;
  endDate: Date;
  summary: string | null;
  reservationCode?: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
  guestProfileUrl?: string | null;
  adults?: number | null;
  children?: number | null;
  infants?: number | null;
  locationText?: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  checkinAtLocal?: Date | null;
  checkoutAtLocal?: Date | null;
  source: string | null;
}): ReservationState {
  return {
    id: row.id,
    uid: row.uid,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    summary: row.summary ?? null,
    reservationCode: row.reservationCode ?? null,
    guestPhone: row.guestPhone ?? null,
    guestEmail: row.guestEmail ?? null,
    guestProfileUrl: row.guestProfileUrl ?? null,
    adults: row.adults ?? null,
    children: row.children ?? null,
    infants: row.infants ?? null,
    locationText: row.locationText ?? null,
    geoLat: row.geoLat ?? null,
    geoLng: row.geoLng ?? null,
    checkinAtLocal: row.checkinAtLocal?.toISOString() ?? null,
    checkoutAtLocal: row.checkoutAtLocal?.toISOString() ?? null,
    source: row.source ?? null,
  };
}

function jobState(row: {
  id: string;
  reservationId: string | null;
  scheduledDate: Date;
  startTime: string | null;
  dueTime: string | null;
  estimatedHours?: number | null;
  internalNotes?: string | null;
  status: string;
  priorityBucket?: number;
  priorityReason?: string | null;
  sameDayCheckin?: boolean;
  sameDayCheckinTime?: string | null;
}): JobState | null {
  if (!row.reservationId) return null;
  return {
    id: row.id,
    reservationId: row.reservationId,
    scheduledDate: row.scheduledDate.toISOString(),
    startTime: row.startTime ?? null,
    dueTime: row.dueTime ?? null,
    estimatedHours: normalizeEstimatedHours(row.estimatedHours),
    internalNotes: row.internalNotes ?? null,
    status: row.status,
    priorityBucket: row.priorityBucket ?? 4,
    priorityReason: row.priorityReason ?? null,
    sameDayCheckin: row.sameDayCheckin === true,
    sameDayCheckinTime: row.sameDayCheckinTime ?? null,
  };
}

function sameReservationState(current: ReservationState, compare: ReservationState) {
  return (
    current.startDate === compare.startDate &&
    current.endDate === compare.endDate &&
    (current.summary ?? null) === (compare.summary ?? null) &&
    (current.reservationCode ?? null) === (compare.reservationCode ?? null) &&
    (current.guestPhone ?? null) === (compare.guestPhone ?? null) &&
    (current.guestEmail ?? null) === (compare.guestEmail ?? null) &&
    (current.guestProfileUrl ?? null) === (compare.guestProfileUrl ?? null) &&
    (current.adults ?? null) === (compare.adults ?? null) &&
    (current.children ?? null) === (compare.children ?? null) &&
    (current.infants ?? null) === (compare.infants ?? null) &&
    (current.locationText ?? null) === (compare.locationText ?? null) &&
    (current.geoLat ?? null) === (compare.geoLat ?? null) &&
    (current.geoLng ?? null) === (compare.geoLng ?? null) &&
    (current.checkinAtLocal ?? null) === (compare.checkinAtLocal ?? null) &&
    (current.checkoutAtLocal ?? null) === (compare.checkoutAtLocal ?? null) &&
    (current.source ?? null) === (compare.source ?? null)
  );
}

function sameJobState(current: JobState, compare: JobState) {
  return (
    current.scheduledDate === compare.scheduledDate &&
    (current.startTime ?? null) === (compare.startTime ?? null) &&
    (current.dueTime ?? null) === (compare.dueTime ?? null) &&
    (current.estimatedHours ?? null) === (compare.estimatedHours ?? null) &&
    (current.internalNotes ?? null) === (compare.internalNotes ?? null) &&
    current.status === compare.status &&
    current.priorityBucket === compare.priorityBucket &&
    (current.priorityReason ?? null) === (compare.priorityReason ?? null) &&
    current.sameDayCheckin === compare.sameDayCheckin &&
    (current.sameDayCheckinTime ?? null) === (compare.sameDayCheckinTime ?? null)
  );
}

function buildEmptySummary(): IcalSyncSummary {
  return {
    feedEvents: 0,
    duplicateFeedEvents: 0,
    ignoredPastEvents: 0,
    reservationsCreated: 0,
    reservationsUpdated: 0,
    reservationsUnchanged: 0,
    jobsCreated: 0,
    jobsUpdated: 0,
    jobsSkippedConflict: 0,
    warnings: [],
  };
}

function getTodaySydneyUtcDateOnly() {
  const sydneyNow = toZonedTime(new Date(), "Australia/Sydney");
  return new Date(Date.UTC(sydneyNow.getFullYear(), sydneyNow.getMonth(), sydneyNow.getDate()));
}

function parseSyncOptions(notes: string | null | undefined): IcalSyncOptions {
  return parseIntegrationNotes(notes).syncOptions ?? { ...DEFAULT_ICAL_SYNC_OPTIONS };
}

async function createOrUpdateReservations(params: {
  propertyId: string;
  provider: string | null;
  events: ParsedFeedEvent[];
  summary: IcalSyncSummary;
  snapshot: IcalSyncSnapshot;
}) {
  const existingReservations = await db.reservation.findMany({
    where: {
      propertyId: params.propertyId,
      uid: { in: params.events.map((event) => event.uid) },
    },
  });
  const existingByUid = new Map(existingReservations.map((row) => [row.uid, row]));

  const touchedReservations: Array<{
    id: string;
    uid: string;
    startDate: Date;
    endDate: Date;
    summary: string | null;
    reservationCode: string | null;
    guestPhone: string | null;
    guestEmail: string | null;
    guestProfileUrl: string | null;
    adults: number | null;
    children: number | null;
    infants: number | null;
    locationText: string | null;
    geoLat: number | null;
    geoLng: number | null;
    checkinAtLocal: Date | null;
    checkoutAtLocal: Date | null;
    source: string | null;
  }> = [];

  for (const event of params.events) {
    const existing = existingByUid.get(event.uid);

    if (!existing) {
      const created = await db.reservation.create({
        data: {
          propertyId: params.propertyId,
          uid: event.uid,
          startDate: event.startDate,
          endDate: event.endDate,
          summary: event.summary,
          reservationCode: event.reservationCode,
          guestPhone: event.guestPhone,
          guestEmail: event.guestEmail,
          guestProfileUrl: event.guestProfileUrl,
          adults: event.adults,
          children: event.children,
          infants: event.infants,
          locationText: event.locationText,
          geoLat: event.geoLat,
          geoLng: event.geoLng,
          checkinAtLocal: event.checkinAtLocal,
          checkoutAtLocal: event.checkoutAtLocal,
          source: params.provider,
        },
      });
      params.summary.reservationsCreated += 1;
      params.snapshot.reservations.push({
        id: created.id,
        uid: created.uid,
        created: true,
        before: null,
        after: reservationState(created),
      });
      touchedReservations.push(created);
      continue;
    }

    const before = reservationState(existing);
    const nextState: ReservationState = {
      id: existing.id,
      uid: existing.uid,
      startDate: event.startDate.toISOString(),
      endDate: event.endDate.toISOString(),
      summary: event.summary ?? null,
      reservationCode: event.reservationCode ?? null,
      guestPhone: event.guestPhone ?? null,
      guestEmail: event.guestEmail ?? null,
      guestProfileUrl: event.guestProfileUrl ?? null,
      adults: event.adults ?? null,
      children: event.children ?? null,
      infants: event.infants ?? null,
      locationText: event.locationText ?? null,
      geoLat: event.geoLat ?? null,
      geoLng: event.geoLng ?? null,
      checkinAtLocal: event.checkinAtLocal?.toISOString() ?? null,
      checkoutAtLocal: event.checkoutAtLocal?.toISOString() ?? null,
      source: existing.source ?? params.provider ?? null,
    };

    if (sameReservationState(before, nextState)) {
      params.summary.reservationsUnchanged += 1;
      touchedReservations.push(existing);
      continue;
    }

    const updated = await db.reservation.update({
      where: { id: existing.id },
      data: {
        startDate: event.startDate,
        endDate: event.endDate,
        summary: event.summary,
        reservationCode: event.reservationCode,
        guestPhone: event.guestPhone,
        guestEmail: event.guestEmail,
        guestProfileUrl: event.guestProfileUrl,
        adults: event.adults,
        children: event.children,
        infants: event.infants,
        locationText: event.locationText,
        geoLat: event.geoLat,
        geoLng: event.geoLng,
        checkinAtLocal: event.checkinAtLocal,
        checkoutAtLocal: event.checkoutAtLocal,
        source: existing.source ?? params.provider ?? undefined,
      },
    });
    params.summary.reservationsUpdated += 1;
    params.snapshot.reservations.push({
      id: updated.id,
      uid: updated.uid,
      created: false,
      before,
      after: reservationState(updated),
    });
    touchedReservations.push(updated);
  }

  return touchedReservations;
}

async function syncTurnoverJobsForReservations(params: {
  propertyId: string;
  property: { defaultCheckoutTime: string; defaultCheckinTime: string; defaultEstimatedHours: number | null };
  reservations: Array<{
    id: string;
    endDate: Date;
    checkoutAtLocal: Date | null;
    summary: string | null;
    reservationCode: string | null;
    guestPhone: string | null;
    guestEmail: string | null;
    guestProfileUrl: string | null;
    adults: number | null;
    children: number | null;
    infants: number | null;
    locationText: string | null;
    geoLat: number | null;
    geoLng: number | null;
    checkinAtLocal: Date | null;
  }>;
  sameDayCheckinsByDate: Map<string, string | null>;
  summary: IcalSyncSummary;
  snapshot: IcalSyncSnapshot;
  syncOptions: IcalSyncOptions;
}) {
  if (!params.syncOptions.autoCreateTurnoverJobs) return;

  const existingJobs = await db.job.findMany({
    where: {
      reservationId: { in: params.reservations.map((reservation) => reservation.id) },
    },
  });
  const existingByReservationId = new Map(existingJobs.map((job) => [job.reservationId, job]));

  for (const reservation of params.reservations) {
    const turnoverDate = reservation.endDate;
    const turnoverDateKey = turnoverDate.toISOString().slice(0, 10);
    const sameDayCheckinTime =
      params.sameDayCheckinsByDate.get(turnoverDateKey) ?? params.property.defaultCheckinTime;
    const priority = classifySameDayCheckinPriority({
      sameDayCheckin: params.sameDayCheckinsByDate.has(turnoverDateKey),
      sameDayCheckinTime,
    });
    const startTime = toLocalTimeString(reservation.checkoutAtLocal) ?? params.property.defaultCheckoutTime;
    const existingJob = existingByReservationId.get(reservation.id);
    const reservationContext = buildReservationContext({
      summary: reservation.summary,
      reservationCode: reservation.reservationCode,
      guestPhone: reservation.guestPhone,
      guestEmail: reservation.guestEmail,
      guestProfileUrl: reservation.guestProfileUrl,
      adults: reservation.adults,
      children: reservation.children,
      infants: reservation.infants,
      locationText: reservation.locationText,
      geoLat: reservation.geoLat,
      geoLng: reservation.geoLng,
      checkinAtLocal: reservation.checkinAtLocal,
      checkoutAtLocal: reservation.checkoutAtLocal,
    });

    if (!existingJob && params.syncOptions.verifyExistingJobConflicts) {
      const conflict = await db.job.findFirst({
        where: {
          propertyId: params.propertyId,
          jobType: "AIRBNB_TURNOVER",
          reservationId: { not: reservation.id },
          scheduledDate: {
            gte: turnoverDate,
            lt: addDays(turnoverDate, 1),
          },
        },
        select: { id: true },
      });
      if (conflict) {
        params.summary.jobsSkippedConflict += 1;
        params.summary.warnings.push(
          `Skipped one turnover job because a conflicting Airbnb turnover job already exists for ${turnoverDate
            .toISOString()
            .slice(0, 10)}.`
        );
        continue;
      }
    }

    if (!existingJob) {
      const jobNumber = await reserveJobNumber(db);
      const created = await db.job.create({
        data: {
          jobNumber,
          propertyId: params.propertyId,
          reservationId: reservation.id,
          jobType: "AIRBNB_TURNOVER",
          status: "UNASSIGNED",
          scheduledDate: turnoverDate,
          startTime,
          dueTime: sameDayCheckinTime,
          estimatedHours: params.property.defaultEstimatedHours ?? undefined,
          internalNotes: mergeReservationContextIntoInternalNotes(undefined, reservationContext),
          priorityBucket: priority.priorityBucket,
          priorityReason: priority.priorityReason,
          sameDayCheckin: priority.sameDayCheckin,
          sameDayCheckinTime: priority.sameDayCheckinTime,
        },
      });
      const after = jobState(created);
      if (after) {
        params.snapshot.jobs.push({
          id: created.id,
          reservationId: reservation.id,
          created: true,
          before: null,
          after,
        });
      }
      params.summary.jobsCreated += 1;
      continue;
    }

    if (TERMINAL_SYNC_JOB_STATUSES.has(existingJob.status)) continue;

    const currentEstimatedHours = normalizeEstimatedHours(existingJob.estimatedHours);
    const shouldBackfillEstimatedHours =
      currentEstimatedHours == null && params.property.defaultEstimatedHours != null;
    const mergedInternalNotes = mergeReservationContextIntoInternalNotes(existingJob.internalNotes, reservationContext);
    const shouldUpdateReservationContext = (mergedInternalNotes ?? null) !== (existingJob.internalNotes ?? null);
    if (!params.syncOptions.updateExistingLinkedJobs && !shouldBackfillEstimatedHours && !shouldUpdateReservationContext) continue;

    const before = jobState(existingJob);
    const afterCandidate: JobState | null = {
      id: existingJob.id,
      reservationId: reservation.id,
      scheduledDate: params.syncOptions.updateExistingLinkedJobs
        ? turnoverDate.toISOString()
        : existingJob.scheduledDate.toISOString(),
      startTime: params.syncOptions.updateExistingLinkedJobs ? startTime : existingJob.startTime ?? null,
      dueTime: params.syncOptions.updateExistingLinkedJobs ? sameDayCheckinTime : existingJob.dueTime ?? null,
      estimatedHours: shouldBackfillEstimatedHours ? params.property.defaultEstimatedHours : currentEstimatedHours,
      internalNotes: shouldUpdateReservationContext ? mergedInternalNotes ?? null : existingJob.internalNotes ?? null,
      status: existingJob.status,
      priorityBucket: params.syncOptions.updateExistingLinkedJobs
        ? priority.priorityBucket
        : existingJob.priorityBucket ?? 4,
      priorityReason: params.syncOptions.updateExistingLinkedJobs
        ? priority.priorityReason
        : existingJob.priorityReason ?? null,
      sameDayCheckin: params.syncOptions.updateExistingLinkedJobs
        ? priority.sameDayCheckin
        : existingJob.sameDayCheckin === true,
      sameDayCheckinTime: params.syncOptions.updateExistingLinkedJobs
        ? priority.sameDayCheckinTime
        : existingJob.sameDayCheckinTime ?? null,
    };
    if (!before || sameJobState(before, afterCandidate)) continue;

    const updated = await db.job.update({
      where: { id: existingJob.id },
      data: {
        ...(params.syncOptions.updateExistingLinkedJobs
          ? {
              scheduledDate: turnoverDate,
              startTime,
              dueTime: sameDayCheckinTime,
              priorityBucket: priority.priorityBucket,
              priorityReason: priority.priorityReason,
              sameDayCheckin: priority.sameDayCheckin,
              sameDayCheckinTime: priority.sameDayCheckinTime,
            }
          : {}),
        ...(shouldBackfillEstimatedHours ? { estimatedHours: params.property.defaultEstimatedHours } : {}),
        ...(shouldUpdateReservationContext ? { internalNotes: mergedInternalNotes } : {}),
      },
    });
    const after = jobState(updated);
    if (after) {
      params.snapshot.jobs.push({
        id: updated.id,
        reservationId: reservation.id,
        created: false,
        before,
        after,
      });
    }
    params.summary.jobsUpdated += 1;
  }
}

async function finalizeRun(params: {
  runId: string;
  integrationId: string;
  summary: IcalSyncSummary;
  snapshot: IcalSyncSnapshot;
  etag?: string;
  lastModified?: string;
}) {
  await Promise.all([
    db.icalSyncRun.update({
      where: { id: params.runId },
      data: {
        status: "SUCCESS",
        summary: params.summary,
        snapshot: params.snapshot,
        completedAt: new Date(),
      },
    }),
    db.integration.update({
      where: { id: params.integrationId },
      data: {
        syncStatus: SyncStatus.SUCCESS,
        lastSyncAt: new Date(),
        lastSyncEtag: params.etag ?? null,
        lastSyncModified: params.lastModified ?? null,
        syncError: null,
      },
    }),
  ]);
}

export async function syncPropertyIcal(
  integrationId: string,
  options: SyncPropertyIcalOptions = {}
): Promise<{ runId: string; summary: IcalSyncSummary }> {
  const integration = await db.integration.findUnique({
    where: { id: integrationId },
    include: { property: true },
  });

  if (!integration || !integration.isEnabled || !integration.icalUrl) {
    logger.info({ integrationId }, "iCal sync skipped - disabled or no URL");
    throw new Error("iCal sync is disabled or missing a URL.");
  }

  const run = await db.icalSyncRun.create({
    data: {
      integrationId,
      propertyId: integration.propertyId,
      triggeredById: options.triggeredById ?? null,
      mode: options.mode ?? "MANUAL",
      status: "RUNNING",
    },
  });

  await db.integration.update({
    where: { id: integrationId },
    data: { syncStatus: SyncStatus.SYNCING },
  });

  const summary = buildEmptySummary();
  const snapshot: IcalSyncSnapshot = { reservations: [], jobs: [] };

  try {
    const syncOptions = parseSyncOptions(integration.notes);
    const todayUtcDateOnly = getTodaySydneyUtcDateOnly();

    const headers: Record<string, string> = {};
    if (integration.lastSyncEtag) headers["If-None-Match"] = integration.lastSyncEtag;
    if (integration.lastSyncModified) headers["If-Modified-Since"] = integration.lastSyncModified;

    const res = await fetch(integration.icalUrl, { headers, cache: "no-store" });

    if (res.status === 304) {
      summary.warnings.push("Feed not modified since the last successful sync.");
      await finalizeRun({ runId: run.id, integrationId, summary, snapshot });
      return { runId: run.id, summary };
    }

    if (!res.ok) throw new Error(`HTTP ${res.status} fetching iCal`);

    const text = await res.text();
    const etag = res.headers.get("etag") ?? undefined;
    const lastModified = res.headers.get("last-modified") ?? undefined;

    const jcal = ICAL.parse(text);
    const comp = new ICAL.Component(jcal);
    const vevents = comp.getAllSubcomponents("vevent");
    summary.feedEvents = vevents.length;

    const uniqueEvents: ParsedFeedEvent[] = [];
    const seenUids = new Set<string>();

    for (const vevent of vevents) {
      const ev = new ICAL.Event(vevent);
      const parsed = parseFeedEvent(ev);
      if (!parsed) continue;
      if (syncOptions.ignorePastDates && parsed.endDate < todayUtcDateOnly) {
        summary.ignoredPastEvents += 1;
        continue;
      }
      if (syncOptions.verifyFeedDuplicates && seenUids.has(parsed.uid)) {
        summary.duplicateFeedEvents += 1;
        continue;
      }
      seenUids.add(parsed.uid);
      uniqueEvents.push(parsed);
    }

    if (summary.duplicateFeedEvents > 0) {
      summary.warnings.push(
        `${summary.duplicateFeedEvents} duplicate event${summary.duplicateFeedEvents === 1 ? "" : "s"} found in the feed and ignored.`
      );
    }
      if (syncOptions.ignorePastDates && summary.ignoredPastEvents > 0) {
        summary.warnings.push(
          `${summary.ignoredPastEvents} past event${summary.ignoredPastEvents === 1 ? "" : "s"} ignored because only current and future stays are synced.`
        );
      }

    const sameDayCheckinsByDate = new Map<string, string | null>();
    for (const event of uniqueEvents) {
      const key = event.startDate.toISOString().slice(0, 10);
      const time = toLocalTimeString(event.checkinAtLocal);
      const existing = sameDayCheckinsByDate.get(key);
      if (!existing || (time && time < existing)) {
        sameDayCheckinsByDate.set(key, time);
      }
    }

    const touchedReservations = await createOrUpdateReservations({
      propertyId: integration.propertyId,
      provider: integration.provider,
      events: uniqueEvents,
      summary,
      snapshot,
    });

    await syncTurnoverJobsForReservations({
      propertyId: integration.propertyId,
      property: {
        defaultCheckoutTime: integration.property.defaultCheckoutTime,
        defaultCheckinTime: integration.property.defaultCheckinTime,
        defaultEstimatedHours: getPropertyDefaultEstimatedHours(integration.property.accessInfo),
      },
      reservations: touchedReservations.map((row) => ({
        id: row.id,
        endDate: row.endDate,
        checkoutAtLocal: row.checkoutAtLocal ?? null,
        summary: row.summary ?? null,
        reservationCode: row.reservationCode ?? null,
        guestPhone: row.guestPhone ?? null,
        guestEmail: row.guestEmail ?? null,
        guestProfileUrl: row.guestProfileUrl ?? null,
        adults: row.adults ?? null,
        children: row.children ?? null,
        infants: row.infants ?? null,
        locationText: row.locationText ?? null,
        geoLat: row.geoLat ?? null,
        geoLng: row.geoLng ?? null,
        checkinAtLocal: row.checkinAtLocal ?? null,
      })),
      sameDayCheckinsByDate,
      summary,
      snapshot,
      syncOptions,
    });

    await finalizeRun({
      runId: run.id,
      integrationId,
      summary,
      snapshot,
      etag,
      lastModified,
    });

    logger.info(
      {
        integrationId,
        propertyId: integration.propertyId,
        runId: run.id,
        summary,
      },
      "iCal synced"
    );

    return { runId: run.id, summary };
  } catch (err: any) {
    logger.error({ err, integrationId, runId: run.id }, "iCal sync failed");
    await Promise.all([
      db.icalSyncRun.update({
        where: { id: run.id },
        data: {
          status: "ERROR",
          error: err.message ?? "Unknown error",
          summary,
          snapshot,
          completedAt: new Date(),
        },
      }),
      db.integration.update({
        where: { id: integrationId },
        data: {
          syncStatus: SyncStatus.ERROR,
          syncError: err.message ?? "Unknown error",
        },
      }),
    ]);
    throw err;
  }
}

export async function undoIcalSyncRun(options: UndoIcalSyncOptions) {
  const run = await db.icalSyncRun.findFirst({
    where: {
      id: options.runId,
      propertyId: options.propertyId,
      status: "SUCCESS",
      revertedAt: null,
    },
  });

  if (!run) {
    throw new Error("Sync run not found or already reverted.");
  }

  const snapshot = (run.snapshot ?? { reservations: [], jobs: [] }) as IcalSyncSnapshot;
  if (snapshot.jobs.length === 0 && snapshot.reservations.length === 0) {
    throw new Error("This sync run did not change any reservations or jobs, so there is nothing to undo.");
  }

  const result = await db.$transaction(async (tx) => {
    const undoResult = {
      deletedJobs: 0,
      restoredJobs: 0,
      deletedReservations: 0,
      restoredReservations: 0,
      skipped: 0,
    };

    for (const jobSnap of [...snapshot.jobs].reverse()) {
      const current = await tx.job.findUnique({ where: { id: jobSnap.id } });
      if (!current) continue;

      const currentState = jobState(current);
      if (jobSnap.created) {
        if (current.reservationId === jobSnap.reservationId) {
          await tx.job.delete({ where: { id: current.id } });
          undoResult.deletedJobs += 1;
        } else {
          undoResult.skipped += 1;
        }
        continue;
      }

      if (!jobSnap.before || !currentState || !sameJobState(currentState, jobSnap.after)) {
        undoResult.skipped += 1;
        continue;
      }

      await tx.job.update({
        where: { id: current.id },
        data: {
          scheduledDate: new Date(jobSnap.before.scheduledDate),
          startTime: jobSnap.before.startTime,
          dueTime: jobSnap.before.dueTime,
          estimatedHours: jobSnap.before.estimatedHours,
          internalNotes: jobSnap.before.internalNotes,
          status: jobSnap.before.status as any,
          priorityBucket: jobSnap.before.priorityBucket,
          priorityReason: jobSnap.before.priorityReason,
          sameDayCheckin: jobSnap.before.sameDayCheckin,
          sameDayCheckinTime: jobSnap.before.sameDayCheckinTime,
        },
      });
      undoResult.restoredJobs += 1;
    }

    for (const reservationSnap of [...snapshot.reservations].reverse()) {
      const current = await tx.reservation.findUnique({
        where: { id: reservationSnap.id },
        include: { job: { select: { id: true } } },
      });
      if (!current) continue;

      const currentState = reservationState(current);
      if (reservationSnap.created) {
        if (!current.job) {
          await tx.reservation.delete({ where: { id: current.id } });
          undoResult.deletedReservations += 1;
        } else {
          undoResult.skipped += 1;
        }
        continue;
      }

      if (!reservationSnap.before || !sameReservationState(currentState, reservationSnap.after)) {
        undoResult.skipped += 1;
        continue;
      }

      await tx.reservation.update({
        where: { id: current.id },
        data: {
          startDate: new Date(reservationSnap.before.startDate),
          endDate: new Date(reservationSnap.before.endDate),
          summary: reservationSnap.before.summary,
          reservationCode: reservationSnap.before.reservationCode,
          guestPhone: reservationSnap.before.guestPhone,
          guestEmail: reservationSnap.before.guestEmail,
          guestProfileUrl: reservationSnap.before.guestProfileUrl,
          adults: reservationSnap.before.adults,
          children: reservationSnap.before.children,
          infants: reservationSnap.before.infants,
          locationText: reservationSnap.before.locationText,
          geoLat: reservationSnap.before.geoLat,
          geoLng: reservationSnap.before.geoLng,
          checkinAtLocal: reservationSnap.before.checkinAtLocal
            ? new Date(reservationSnap.before.checkinAtLocal)
            : null,
          checkoutAtLocal: reservationSnap.before.checkoutAtLocal
            ? new Date(reservationSnap.before.checkoutAtLocal)
            : null,
          source: reservationSnap.before.source ?? undefined,
        },
      });
      undoResult.restoredReservations += 1;
    }

    const changedCount =
      undoResult.deletedJobs +
      undoResult.restoredJobs +
      undoResult.deletedReservations +
      undoResult.restoredReservations;

    if (changedCount === 0) {
      if (undoResult.skipped > 0) {
        throw new Error(
          "This sync run could not be safely reverted because the synced jobs or reservations were changed after the sync."
        );
      }
      throw new Error("This sync run has nothing left to undo.");
    }

    await tx.icalSyncRun.update({
      where: { id: run.id },
      data: {
        status: "REVERTED",
        revertedAt: new Date(),
        revertedById: options.revertedById ?? null,
        summary: {
          ...((run.summary as Record<string, unknown> | null) ?? {}),
          undoResult,
        },
      },
    });

    return undoResult;
  });

  return result;
}

/** Sync all enabled integrations. Called by pg-boss worker. */
export async function syncAllIcal(): Promise<void> {
  const integrations = await db.integration.findMany({
    where: { isEnabled: true, icalUrl: { not: null } },
  });

  for (const intg of integrations) {
    await syncPropertyIcal(intg.id, { mode: "AUTO" });
  }
}
