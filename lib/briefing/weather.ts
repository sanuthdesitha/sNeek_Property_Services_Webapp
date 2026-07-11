/**
 * Keyless weather for the cleaner briefing — Open-Meteo daily forecast.
 *
 * No API key, no PII. Uses the first property's lat/lng (falling back to central
 * Sydney) and a 5-second timeout; any failure resolves to null so the briefing
 * stays null-safe. `dayOffset` selects today (0) or tomorrow (1) from the daily
 * arrays (the request is pinned to the Australia/Sydney timezone).
 */
import type { BriefingWeather } from "@/lib/briefing/types";

const SYDNEY_LAT = -33.87;
const SYDNEY_LNG = 151.21;
const WET_WEATHER_THRESHOLD = 40; // precip probability (%) that warrants gear

/** WMO weather-code → short human description. */
function describeWeatherCode(code: number | null | undefined): string {
  if (code == null) return "Weather";
  if (code === 0) return "Clear";
  if (code === 1 || code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorms";
  return "Weather";
}

export async function getBriefingWeather(input: {
  latitude?: number | null;
  longitude?: number | null;
  dayOffset: number; // 0 = today, 1 = tomorrow
}): Promise<BriefingWeather | null> {
  const lat =
    typeof input.latitude === "number" && Number.isFinite(input.latitude) ? input.latitude : SYDNEY_LAT;
  const lng =
    typeof input.longitude === "number" && Number.isFinite(input.longitude) ? input.longitude : SYDNEY_LNG;
  const idx = Math.max(0, Math.min(6, Math.round(input.dayOffset)));

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=Australia/Sydney&forecast_days=${idx + 1}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    const data: any = await res.json();
    const daily = data?.daily;
    if (!daily || !Array.isArray(daily.time) || idx >= daily.time.length) return null;

    const code = Array.isArray(daily.weather_code) ? Number(daily.weather_code[idx]) : null;
    const tMax = Array.isArray(daily.temperature_2m_max) ? Number(daily.temperature_2m_max[idx]) : null;
    const tMin = Array.isArray(daily.temperature_2m_min) ? Number(daily.temperature_2m_min[idx]) : null;
    const precip = Array.isArray(daily.precipitation_probability_max)
      ? Number(daily.precipitation_probability_max[idx])
      : null;

    const desc = describeWeatherCode(code);
    const tempParts: string[] = [];
    if (Number.isFinite(tMin)) tempParts.push(`${Math.round(tMin as number)}`);
    if (Number.isFinite(tMax)) tempParts.push(`${Math.round(tMax as number)}`);
    const tempLine = tempParts.length === 2 ? `${tempParts.join("–")}°C` : tempParts.length === 1 ? `${tempParts[0]}°C` : "";

    const precipProbability = Number.isFinite(precip) ? Math.round(precip as number) : null;
    const wetWeatherGear = precipProbability != null && precipProbability >= WET_WEATHER_THRESHOLD;

    const summary = [desc, tempLine].filter(Boolean).join(" · ") || "Weather unavailable";

    return {
      summary,
      wetWeatherGear,
      precipProbability,
      trafficBuffer: null, // filled by the assembler from the schedule
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
