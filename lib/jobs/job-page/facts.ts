/**
 * The key-facts row under the stage bar: Guest out, Next guest in, Time on
 * site, Checklist, Charge, Margin. Each fact is either a value with its note,
 * or an honest "not recorded" — never a zero standing in for missing data.
 */
import { formatInTimeZone } from "date-fns-tz";
import { formatMoney, NOT_ENOUGH_DATA, type JobMoneySummary } from "./money";

const CHARGE_NOTES: Record<JobMoneySummary["chargeState"], string | null> = {
  fixed: "fixed price",
  "property-rate": "property rate",
  "price-book": "price book",
  "no-rate": null,
  "draft-invoice": "on a draft invoice",
  locked: "on the issued invoice",
};

export type FactTone = "neutral" | "warning" | "success";

export type JobFact = {
  key: "guest-out" | "guest-in" | "time-on-site" | "checklist" | "charge" | "margin";
  label: string;
  value: string;
  /** True when the value is a "not recorded" sentence rather than data. */
  unknown: boolean;
  note: string | null;
  badge: { text: string; tone: FactTone } | null;
};

export type TimeLogSpan = { startedAt: Date; stoppedAt: Date | null };

export type ChecklistCount = { done: number; total: number } | null;

export type JobFactsInput = {
  timeZone: string;
  departing: { name: string | null; checkoutAt: Date | null } | null;
  arriving: { name: string | null; checkinAt: Date | null } | null;
  sameDayCheckin: boolean;
  sameDayCheckinTime: string | null;
  serviceDateKey: string;
  timeLogs: TimeLogSpan[];
  allocatedHours: number | null;
  now: Date;
  checklist: ChecklistCount;
  flaggedCount: number;
  money: JobMoneySummary;
};

export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} m`;
  return `${hours} h ${String(rest).padStart(2, "0")} m`;
}

/** Wall-clock time on site: first clock-in to last clock-out (or now while a clock runs). */
export function siteMinutes(logs: TimeLogSpan[], now: Date): { minutes: number; running: boolean } | null {
  if (logs.length === 0) return null;
  const start = Math.min(...logs.map((log) => log.startedAt.getTime()));
  const running = logs.some((log) => log.stoppedAt === null);
  const end = running ? now.getTime() : Math.max(...logs.map((log) => (log.stoppedAt ?? log.startedAt).getTime()));
  return { minutes: (end - start) / 60_000, running };
}

function fact(key: JobFact["key"], label: string, value: string | null, rest: Partial<Pick<JobFact, "note" | "badge">> = {}, unknownText = "Not recorded"): JobFact {
  return { key, label, value: value ?? unknownText, unknown: value === null, note: rest.note ?? null, badge: rest.badge ?? null };
}

export function buildJobFacts(input: JobFactsInput): JobFact[] {
  const tz = input.timeZone;
  const time = (date: Date) => formatInTimeZone(date, tz, "HH:mm");
  const dayKey = (date: Date) => formatInTimeZone(date, tz, "yyyy-MM-dd");

  const departing = input.departing;
  const guestOut = fact("guest-out", "Guest out", departing?.checkoutAt ? time(departing.checkoutAt) : null, {
    note: departing?.name ?? null,
  });

  const arriving = input.arriving;
  let guestInValue: string | null = null;
  if (arriving?.checkinAt) {
    guestInValue = dayKey(arriving.checkinAt) === input.serviceDateKey ? `${time(arriving.checkinAt)} same day` : formatInTimeZone(arriving.checkinAt, tz, "EEE d MMM HH:mm");
  } else if (input.sameDayCheckin && input.sameDayCheckinTime) {
    guestInValue = `${input.sameDayCheckinTime} same day`;
  }
  const guestIn = fact("guest-in", "Next guest in", guestInValue, {
    note: arriving?.name ?? null,
    badge: input.sameDayCheckin ? { text: "Same day", tone: "warning" } : null,
  }, "No incoming booking");

  const site = siteMinutes(input.timeLogs, input.now);
  const allocated = input.allocatedHours != null ? `of ${input.allocatedHours} h allocated` : "no allocated hours";
  const timeOnSite = fact("time-on-site", "Time on site", site ? formatMinutes(site.minutes) : null, {
    note: site ? `${site.running ? "running, " : ""}${allocated}` : null,
  }, "Not started");

  const checklist = fact("checklist", "Checklist", input.checklist ? `${input.checklist.done} of ${input.checklist.total}` : null, {
    note: input.checklist ? "required items" : null,
    badge: input.flaggedCount > 0 ? { text: `${input.flaggedCount} flagged`, tone: "warning" } : null,
  }, "No submission yet");

  const money = input.money;
  const charge = fact("charge", "Charge", money.charge.kind === "amount" ? formatMoney(money.charge.amount) : null, { note: CHARGE_NOTES[money.chargeState] }, "No rate");

  const margin = fact("margin", "Margin", money.margin.kind === "amount" ? formatMoney(money.margin.amount) : null, {
    note: money.margin.kind === "amount" ? `${money.marginPercent != null ? `${money.marginPercent}%, ` : ""}estimate` : null,
  }, NOT_ENOUGH_DATA);

  return [guestOut, guestIn, timeOnSite, checklist, charge, margin];
}
