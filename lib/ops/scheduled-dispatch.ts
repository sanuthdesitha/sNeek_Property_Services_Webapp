import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

export function parseDispatchTime(value: string | null | undefined, fallbackHour = 0, fallbackMinute = 0) {
  const match = String(value ?? "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return { hour: fallbackHour, minute: fallbackMinute };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return { hour: fallbackHour, minute: fallbackMinute };
  }
  return {
    hour: Math.max(0, Math.min(23, hour)),
    minute: Math.max(0, Math.min(59, minute)),
  };
}

export function localDateKey(date: Date, timezone: string) {
  return format(toZonedTime(date, timezone), "yyyy-MM-dd");
}

export function isPastLocalDispatchTime(
  now: Date,
  timezone: string,
  timeValue: string | null | undefined,
  fallbackHour = 0,
  fallbackMinute = 0
) {
  const localNow = toZonedTime(now, timezone);
  const { hour, minute } = parseDispatchTime(timeValue, fallbackHour, fallbackMinute);
  const currentMinutes = localNow.getHours() * 60 + localNow.getMinutes();
  const targetMinutes = hour * 60 + minute;
  return currentMinutes >= targetMinutes;
}
