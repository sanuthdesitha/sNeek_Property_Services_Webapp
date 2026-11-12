/**
 * "Coming up, from the calendar and jobs": the property's next turnover days,
 * joining the booking that leaves, the booking that arrives, the job and its
 * laundry run. Pure: the loader passes rows in, nothing is read or written
 * here. Every gap is stated (no booking yet, no job, no laundry service),
 * never filled in.
 */
import { formatInTimeZone } from "date-fns-tz";
import { addDaysToKey, sydneyDateKey } from "@/lib/time/sydney-range";

export type ComingUpReservation = {
  id: string;
  startDate: Date;
  endDate: Date;
  guestName: string | null;
  checkinAtLocal: Date | null;
  checkoutAtLocal: Date | null;
};

export type ComingUpLaundry = {
  status: string;
  pickupDate: Date;
  pickupTime: string | null;
  noPickupRequired: boolean;
};

export type ComingUpJob = {
  id: string;
  jobNumber: string;
  scheduledDate: Date;
  startTime: string | null;
  status: string;
  reservationId: string | null;
  cleaners: string[];
  laundry: ComingUpLaundry | null;
};

export type ComingUpGuest = { name: string | null; time: string | null };

export type ComingUpLaundryCell =
  | { kind: "pickup"; dayKey: string; time: string | null; sameDay: boolean }
  | { kind: "status"; label: string }
  | { kind: "not-needed" }
  | { kind: "none" }
  | { kind: "off" };

export type ComingUpRow = {
  key: string;
  dayKey: string;
  guestOut: ComingUpGuest | null;
  guestIn: ComingUpGuest | null;
  /** Someone leaves and someone arrives on the same day. */
  sameDay: boolean;
  job: { id: string; jobNumber: string; status: string; startTime: string | null } | null;
  /** Only when there is no job: whether the calendar sync will create one. */
  missingJob: "created-at-next-sync" | "no-job" | null;
  cleaners: string[];
  laundry: ComingUpLaundryCell;
};

export type ComingUpInput = {
  todayKey: string;
  windowDays: number;
  maxRows: number;
  timeZone: string;
  defaultCheckinTime: string | null;
  defaultCheckoutTime: string | null;
  laundryEnabled: boolean;
  /** Calendar linked and set to create turnover jobs. */
  syncCreatesJobs: boolean;
  reservations: ComingUpReservation[];
  jobs: ComingUpJob[];
};

function localTime(value: Date | null, timeZone: string, fallback: string | null): string | null {
  if (value && !Number.isNaN(value.getTime())) return formatInTimeZone(value, timeZone, "HH:mm");
  return fallback;
}

function laundryCell(laundry: ComingUpLaundry | null, dayKey: string, laundryEnabled: boolean): ComingUpLaundryCell {
  if (!laundry) return laundryEnabled ? { kind: "none" } : { kind: "off" };
  if (laundry.noPickupRequired) return { kind: "not-needed" };
  if (laundry.status === "DROPPED") return { kind: "status", label: "Delivered" };
  if (laundry.status === "PICKED_UP") return { kind: "status", label: "Picked up" };
  if (laundry.status === "SKIPPED_PICKUP") return { kind: "status", label: "Pickup skipped" };
  const pickupKey = sydneyDateKey(laundry.pickupDate);
  return { kind: "pickup", dayKey: pickupKey, time: laundry.pickupTime, sameDay: pickupKey === dayKey };
}

export function buildComingUp(input: ComingUpInput): ComingUpRow[] {
  const endKey = addDaysToKey(input.todayKey, input.windowDays);
  const inWindow = (key: string) => key >= input.todayKey && key < endKey;
  const guestOut = (reservation: ComingUpReservation): ComingUpGuest => ({
    name: reservation.guestName?.trim() || null,
    time: localTime(reservation.checkoutAtLocal, input.timeZone, input.defaultCheckoutTime),
  });
  const guestIn = (reservation: ComingUpReservation): ComingUpGuest => ({
    name: reservation.guestName?.trim() || null,
    time: localTime(reservation.checkinAtLocal, input.timeZone, input.defaultCheckinTime),
  });

  const reservationsById = new Map(input.reservations.map((row) => [row.id, row]));
  const checkoutsByDay = new Map<string, ComingUpReservation>();
  const checkinsByDay = new Map<string, ComingUpReservation>();
  for (const reservation of input.reservations) {
    checkoutsByDay.set(sydneyDateKey(reservation.endDate), reservation);
    checkinsByDay.set(sydneyDateKey(reservation.startDate), reservation);
  }

  const rows: ComingUpRow[] = [];
  const daysWithJobs = new Set<string>();
  for (const job of input.jobs) {
    const dayKey = sydneyDateKey(job.scheduledDate);
    if (!inWindow(dayKey)) continue;
    daysWithJobs.add(dayKey);
    const leaving = (job.reservationId ? reservationsById.get(job.reservationId) : undefined) ?? checkoutsByDay.get(dayKey);
    const arriving = checkinsByDay.get(dayKey);
    rows.push({
      key: `job:${job.id}`,
      dayKey,
      guestOut: leaving ? guestOut(leaving) : null,
      guestIn: arriving ? guestIn(arriving) : null,
      sameDay: Boolean(leaving && arriving),
      job: { id: job.id, jobNumber: job.jobNumber, status: job.status, startTime: job.startTime },
      missingJob: null,
      cleaners: job.cleaners,
      laundry: laundryCell(job.laundry, dayKey, input.laundryEnabled),
    });
  }

  // A booking that leaves inside the window with no job that day.
  for (const [dayKey, leaving] of Array.from(checkoutsByDay.entries())) {
    if (!inWindow(dayKey) || daysWithJobs.has(dayKey)) continue;
    const arriving = checkinsByDay.get(dayKey);
    rows.push({
      key: `checkout:${leaving.id}`,
      dayKey,
      guestOut: guestOut(leaving),
      guestIn: arriving ? guestIn(arriving) : null,
      sameDay: Boolean(arriving),
      job: null,
      missingJob: input.syncCreatesJobs ? "created-at-next-sync" : "no-job",
      cleaners: [],
      laundry: input.laundryEnabled ? { kind: "none" } : { kind: "off" },
    });
  }

  return rows
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || (a.job?.startTime ?? "99:99").localeCompare(b.job?.startTime ?? "99:99"))
    .slice(0, input.maxRows);
}
