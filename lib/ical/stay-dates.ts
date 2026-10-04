import type ICAL from "ical.js";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { JobReservationContext } from "@/lib/jobs/meta";
/** Require explicit dates: ical.js otherwise fabricates a one-day end for an all-day event. */
export function incomingStayDates(event: ICAL.Event, propertyTimezone = "Australia/Sydney"): Pick<JobReservationContext, "stayStartDate" | "stayEndDate" | "staySource"> {
  if (!event.component.hasProperty("dtstart") || !event.component.hasProperty("dtend")) return {};
  const date = (value: ICAL.Time, name: string) => {
    const calendar = `${String(value.year).padStart(4,"0")}-${String(value.month).padStart(2,"0")}-${String(value.day).padStart(2,"0")}`;
    if (value.isDate) return calendar;
    const timezone = event.component.getFirstProperty(name)?.getParameter("tzid");
    if (value.zone.tzid === "UTC") return formatInTimeZone(value.toJSDate(), propertyTimezone, "yyyy-MM-dd");
    if (typeof timezone === "string") {
      const time = `${calendar}T${String(value.hour).padStart(2,"0")}:${String(value.minute).padStart(2,"0")}:${String(value.second).padStart(2,"0")}`;
      return formatInTimeZone(fromZonedTime(time, timezone), propertyTimezone, "yyyy-MM-dd");
    }
    return calendar; // Floating time is property-local; never interpret it in server TZ.
  };
  try { return { stayStartDate: date(event.startDate,"dtstart"), stayEndDate: date(event.endDate,"dtend"), staySource: "ICAL" }; }
  catch { return {}; }
}
/** The departing reservation must never be used as the incoming stay. */
export function nextIncomingStay<T>(byCheckinDate: Map<string, T>, turnoverDate: string, calendarDate?: (value: T) => string | undefined): T | undefined {
  return Array.from(byCheckinDate.entries()).map(([date, value]) => ({ date: calendarDate?.(value) ?? date, value }))
    .filter(row => row.date >= turnoverDate).sort((a, b) => a.date.localeCompare(b.date))[0]?.value;
}
