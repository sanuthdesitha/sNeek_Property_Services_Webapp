/**
 * Period reading for the classic accountability routes that predate the
 * Quality hub. They only ever offered 7d / 30d / 90d and read anything else as
 * 30d; that leniency is kept so the classic pages behave as before, but the
 * boundaries now come from the shared Sydney-day period helper.
 */
import { resolveQualityPeriod, type QualityPeriod } from "./period";

export function legacyAccountabilityPeriod(raw: string | null, now: Date = new Date()): QualityPeriod {
  const key = raw === "7d" || raw === "90d" ? raw : "30d";
  return resolveQualityPeriod({ period: key }, now);
}
