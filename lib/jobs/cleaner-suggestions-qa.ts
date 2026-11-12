import "server-only";
import { cleanTotalsByCleaner } from "@/lib/quality/cleans";
import { loadCleanFacts } from "@/lib/quality/facts";
import { resolveQualityPeriod } from "@/lib/quality/period";
import { EMPTY_QUALITY_FILTERS } from "@/lib/quality/types";
import type { SuggestionQa } from "./cleaner-suggestions-signals";

/**
 * QA scores for suggested cleaners: the Quality hub's own Cleaners-tab figure
 * (average authoritative review score, reviewed cleans) over the hub's default
 * 30-day Sydney period, with no other filters. ONE clean read covers every
 * candidate (`loadCleanFacts` + `cleanTotalsByCleaner`), the same functions
 * the hub uses, so the number in the panel equals the hub's.
 *
 * A cleaner with no clean in the period gets `{ score: null, reviewed: 0 }`.
 */
export const SUGGESTION_QA_PERIOD = "30d";

export async function loadSuggestionQaScores(cleanerIds: readonly string[], now: Date = new Date()): Promise<Map<string, SuggestionQa>> {
  const out = new Map<string, SuggestionQa>();
  if (cleanerIds.length === 0) return out;
  const period = resolveQualityPeriod({ period: SUGGESTION_QA_PERIOD }, now);
  const cleans = await loadCleanFacts(period, EMPTY_QUALITY_FILTERS);
  const totals = cleanTotalsByCleaner(cleans, period);
  const periodDays = period.days ?? 30;
  for (const id of cleanerIds) {
    const row = totals.get(id);
    out.set(id, { score: row?.avgScore ?? null, reviewed: row?.reviewed ?? 0, periodDays });
  }
  return out;
}
