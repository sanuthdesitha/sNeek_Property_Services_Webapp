import "server-only";
import { JobStatus, type JobType } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { computeDraftItem } from "@/lib/laundry/planner";
import { partnerTimesForNewRun } from "@/lib/laundry/partner-schedule-server";
import { loadSchedulingRuleBook } from "@/lib/scheduling-rules/store";
import { laundryOperationsFrom, laundryPlanningFrom } from "@/lib/scheduling-rules/values";
import { isAutoEmailAllowed } from "@/lib/notifications/email-kinds";
import { previewLifecycleEmail, renderLifecycleEmail } from "@/lib/notifications/lifecycle";
import { loadSuggestionsForSlot } from "@/lib/jobs/cleaner-suggestions-load";
import type {
  NewJobBooking,
  NewJobBookingEmail,
  NewJobDay,
  NewJobDayCheck,
  NewJobLaundryPreview,
  NewJobSameDayJob,
} from "./types";

/**
 * The When, Who, laundry and client-email facts for an UNSAVED job, from the
 * same data and the same functions the real work uses. READ ONLY: no job,
 * assignment, laundry run, notification or audit row is written.
 *
 * - Calendar: the stored iCal reservations ending (guest out) and starting
 *   (guest in) that day, matched by the same UTC date key the sync uses.
 * - Clash: every job already at the property that day (cancelled excluded).
 * - Laundry: the live planner's `computeDraftItem` on a stand-in job that is
 *   never saved, with the live scheduling-rules version and the partner's
 *   planned times. Other dates picked on the page are not counted, because
 *   the planner only sees saved jobs.
 * - Cleaners: the existing ranker for the slot (`loadSuggestionsForSlot`).
 * - Booking email: the booking-confirmation template rendered with its gates
 *   (automation switch, the client's choice, recipients, provider key).
 */
export type DayCheckInput = {
  propertyId: string;
  jobType: JobType;
  dayKeys: string[];
  startTime: string | null;
  dueTime: string | null;
  endTime: string | null;
  estimatedHours: number | null;
  suggest: boolean;
  timezone: string;
};

const PREVIEW_JOB_ID = "new-job-preview";
const DAY_MS = 86_400_000;
const UNFINISHED_EXCLUDED: JobStatus[] = [JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED, JobStatus.CANCELLED];

type PlannerJobArg = Parameters<typeof computeDraftItem>[0];
type ReservationRow = {
  startDate: Date;
  endDate: Date;
  guestName: string | null;
  reservationCode: string | null;
  adults: number | null;
  children: number | null;
  checkinAtLocal: Date | null;
  checkoutAtLocal: Date | null;
};

function dayStart(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

function toMinutes(value: string | null): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function booking(row: ReservationRow, kind: "in" | "out", timezone: string): NewJobBooking {
  const instant = kind === "in" ? row.checkinAtLocal : row.checkoutAtLocal;
  const nights = Math.round((row.endDate.getTime() - row.startDate.getTime()) / DAY_MS);
  return {
    guestName: row.guestName,
    reservationCode: row.reservationCode,
    time: instant ? formatInTimeZone(instant, timezone, "HH:mm") : null,
    adults: row.adults,
    children: row.children,
    nights: nights > 0 ? nights : null,
  };
}

function windowHours(out: NewJobBooking | null, incoming: NewJobBooking | null): number | null {
  const from = toMinutes(out?.time ?? null);
  const to = toMinutes(incoming?.time ?? null);
  if (from === null || to === null || to <= from) return null;
  return Math.round(((to - from) / 60) * 100) / 100;
}

async function laundryFor(input: DayCheckInput, dayKey: string, property: PlannerJobArg["property"] | null, rulesVersion: number | null, values: Parameters<typeof laundryOperationsFrom>[0] | null): Promise<NewJobLaundryPreview> {
  if (input.jobType !== "AIRBNB_TURNOVER") return { kind: "not_applicable", reason: "Only Airbnb turnovers get a laundry run." };
  if (!property) return { kind: "unavailable", reason: "The property could not be read." };
  if (property.laundryEnabled === false) return { kind: "not_applicable", reason: "Laundry is off for this property." };
  if (!values || rulesVersion === null) return { kind: "unavailable", reason: "The scheduling rules could not be read, so no preview is shown." };
  const standIn = {
    id: PREVIEW_JOB_ID,
    propertyId: property.id,
    jobType: input.jobType,
    isRework: false,
    scheduledDate: dayStart(dayKey),
    startTime: input.startTime,
    dueTime: input.dueTime,
    endTime: input.endTime,
    internalNotes: null,
    property,
  } as unknown as PlannerJobArg;
  const item = await computeDraftItem(standIn, laundryOperationsFrom(values), db, laundryPlanningFrom(values));
  const times = await partnerTimesForNewRun(db, {
    propertyId: property.id, pickupDate: new Date(item.pickupDate), dropoffDate: new Date(item.dropoffDate), flagNotes: item.flagNotes,
  }).catch(() => ({ pickupTime: null, dropoffTime: null }));
  const next = await db.job.findFirst({
    where: { propertyId: property.id, jobType: "AIRBNB_TURNOVER", isRework: false, scheduledDate: { gt: dayStart(dayKey) }, status: { not: "INVOICED" } },
    select: { scheduledDate: true },
    orderBy: { scheduledDate: "asc" },
  });
  return {
    kind: "preview",
    rulesVersion,
    pickupDate: item.pickupDate.slice(0, 10),
    dropoffDate: item.dropoffDate.slice(0, 10),
    pickupTime: times.pickupTime,
    dropoffTime: times.dropoffTime,
    scenario: item.scenario,
    flagged: item.status === "FLAGGED",
    flagReason: item.flagReason,
    note: item.flagNotes,
    nextCleanDayKey: next ? next.scheduledDate.toISOString().slice(0, 10) : null,
  };
}

function carryForwardFor(dayKey: string, startTime: string | null, earliest: { scheduledDate: Date; startTime: string | null } | null, openCount: number): NewJobDay["carryForwardAttaches"] {
  if (openCount === 0) return "not_applicable";
  if (!earliest) return "yes";
  const earliestKey = earliest.scheduledDate.toISOString().slice(0, 10);
  if (dayKey !== earliestKey) return dayKey < earliestKey ? "yes" : "no";
  const mine = toMinutes(startTime);
  const theirs = toMinutes(earliest.startTime);
  return mine !== null && theirs !== null && mine < theirs ? "yes" : "no";
}

function stripHtml(html: string): string {
  return html.replace(/<\/p>/g, "\n").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/\n{2,}/g, "\n").trim();
}

async function bookingEmailFor(input: DayCheckInput, dayKey: string, property: { name: string; suburb: string; clientId: string }): Promise<NewJobBookingEmail> {
  const [settings, client, preview] = await Promise.all([
    getAppSettings(),
    db.client.findUnique({ where: { id: property.clientId }, select: { id: true, name: true, notificationPref: { select: { notificationsEnabled: true } } } }),
    previewLifecycleEmail({ clientId: property.clientId, stage: "BOOKING_CONFIRMED" }),
  ]);
  const automationOn = isAutoEmailAllowed(settings.emailAutomation, "client_job_update");
  const clientOptedOut = client?.notificationPref?.notificationsEnabled === false;
  const providerConfigured = Boolean(process.env.RESEND_API_KEY?.trim());
  const scheduleText = dayStart(dayKey).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const rendered = client
    ? renderLifecycleEmail(
        "BOOKING_CONFIRMED",
        {
          companyName: settings.companyName || "sNeek Property Services",
          clientId: client.id,
          clientName: client.name,
          jobId: null,
          jobNumber: null,
          propertyName: property.suburb ? `${property.name} (${property.suburb})` : property.name,
          serviceLabel: input.jobType.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
          scheduledText: null,
          portalUrl: "",
          notificationsEnabled: !clientOptedOut,
        },
        { scheduleText },
      )
    : null;
  const blockedReason = !client
    ? "This property has no client to email."
    : !automationOn
      ? "Client job update emails are switched off in email automation."
      : clientOptedOut
        ? "This client has turned off notifications."
        : preview.recipients.length === 0
          ? "The client has no active portal login with an email address."
          : !providerConfigured
            ? "The email provider is not configured here, so nothing would be sent."
            : null;
  return {
    applies: Boolean(client),
    automationOn,
    clientOptedOut,
    providerConfigured,
    recipients: preview.recipients,
    subject: rendered?.subject ?? null,
    bodyText: rendered ? stripHtml(rendered.html.replace(/<p style="margin:18px 0;">[\s\S]*?<\/p>/g, "")) : null,
    blockedReason,
  };
}

export async function loadNewJobDayCheck(input: DayCheckInput): Promise<NewJobDayCheck | null> {
  const property = await db.property.findUnique({ where: { id: input.propertyId } });
  if (!property) return null;
  const keys = input.dayKeys;
  const first = dayStart(keys[0]);
  const last = new Date(dayStart(keys[keys.length - 1]).getTime() + DAY_MS);

  let rulesVersion: number | null = null;
  let values: Parameters<typeof laundryOperationsFrom>[0] | null = null;
  if (input.jobType === "AIRBNB_TURNOVER" && property.laundryEnabled !== false) {
    try {
      const book = await loadSchedulingRuleBook(db);
      rulesVersion = book.live.version;
      values = book.live.values;
    } catch {
      rulesVersion = null;
    }
  }

  const [reservations, jobs, earliest, openCarry] = await Promise.all([
    db.reservation.findMany({
      where: { propertyId: property.id, OR: [{ endDate: { gte: first, lt: last } }, { startDate: { gte: first, lt: last } }] },
      select: { startDate: true, endDate: true, guestName: true, reservationCode: true, adults: true, children: true, checkinAtLocal: true, checkoutAtLocal: true },
    }),
    db.job.findMany({
      where: { propertyId: property.id, scheduledDate: { gte: first, lt: last }, status: { not: JobStatus.CANCELLED } },
      select: {
        id: true, jobNumber: true, jobType: true, startTime: true, status: true, scheduledDate: true, reservationId: true,
        assignments: { where: { removedAt: null }, select: { responseStatus: true, user: { select: { name: true, email: true } } } },
      },
      orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
    }),
    db.job.findFirst({
      where: { propertyId: property.id, status: { notIn: UNFINISHED_EXCLUDED } },
      select: { scheduledDate: true, startTime: true },
      orderBy: [{ scheduledDate: "asc" }, { startTime: "asc" }],
    }),
    db.jobTask.count({ where: { propertyId: property.id, source: "CARRY_FORWARD", jobId: null, executionStatus: "OPEN" } }),
  ]);

  const days: NewJobDay[] = [];
  for (const dayKey of keys) {
    const outRow = reservations.find((row) => row.endDate.toISOString().slice(0, 10) === dayKey) ?? null;
    const inRow = reservations.find((row) => row.startDate.toISOString().slice(0, 10) === dayKey) ?? null;
    const guestOut = outRow ? booking(outRow, "out", input.timezone) : null;
    const guestIn = inRow ? booking(inRow, "in", input.timezone) : null;
    const sameDayJobs: NewJobSameDayJob[] = jobs
      .filter((job) => job.scheduledDate.toISOString().slice(0, 10) === dayKey)
      .map((job) => ({
        jobId: job.id,
        jobNumber: job.jobNumber,
        jobType: job.jobType,
        startTime: job.startTime,
        status: job.status,
        fromCalendar: Boolean(job.reservationId),
        cleaners: job.assignments.map((assignment) => assignment.user.name?.trim() || assignment.user.email),
        accepted: job.assignments.some((assignment) => assignment.responseStatus === "ACCEPTED"),
      }));
    days.push({
      dayKey,
      guestOut,
      guestIn,
      windowHours: windowHours(guestOut, guestIn),
      sameDayJobs,
      laundry: await laundryFor(input, dayKey, property as PlannerJobArg["property"], rulesVersion, values),
      carryForwardAttaches: carryForwardFor(dayKey, input.startTime, earliest, openCarry),
    });
  }

  const location = property.latitude != null && property.longitude != null ? { lat: property.latitude, lng: property.longitude } : null;
  let suggestions: NewJobDayCheck["suggestions"] = { kind: "not_requested" };
  if (input.suggest) {
    const ranked = await loadSuggestionsForSlot({
      jobId: null, propertyId: property.id, dayKey: keys[0], startTime: input.startTime, endTime: input.endTime,
      dueTime: input.dueTime, estimatedHours: input.estimatedHours, location,
    });
    suggestions = { kind: "ok", dayKey: keys[0], items: ranked.suggestions, considered: ranked.considered };
  }

  return {
    days,
    suggestions,
    bookingEmail: await bookingEmailFor(input, keys[0], property),
  };
}
