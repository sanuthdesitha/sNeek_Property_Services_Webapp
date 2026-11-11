/**
 * The two signals that decide a cleaner row's action on the Quality hub, read
 * from the EXISTING flows and never re-derived:
 *
 * - Bonus: a PENDING accountability bonus proposal (STREAK_5, STREAK_10,
 *   MONTHLY_RANK_1/2) the nightly job already created under the bonus rules in
 *   lib/accountability/streaks.ts. The hub only offers the existing approve /
 *   decline decision (PATCH /api/admin/pay-adjustments/[id]).
 * - Coaching: a recurring-issue pattern from lib/accountability/patterns.ts
 *   (same category for the same cleaner, settings-driven count and window),
 *   which is what coaching records are "recommended by pattern detection" for.
 *   Starting coaching posts to the existing coaching route.
 */
import { PayAdjustmentStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { detectPatterns, type PatternIssue } from "@/lib/accountability/patterns";
import { BONUS_SOURCES, OPEN_COACHING_STATUSES } from "./types";

export type BonusProposal = {
  id: string;
  title: string;
  amount: number | null;
  source: string;
  createdAt: string;
};

export type CoachingSuggestion = {
  category: string;
  label: string;
  count: number;
  windowDays: number;
  patternKey: string;
  issueIds: string[];
};

export type CleanerSignals = {
  bonuses: Map<string, BonusProposal[]>;
  openCoaching: Map<string, number>;
  suggestions: Map<string, CoachingSuggestion>;
};

const DAY_MS = 86_400_000;

type PatternIssueRow = PatternIssue & { id: string };

/** Strongest pattern per cleaner, with the ids of the issues behind it. */
export function strongestPatterns(
  issues: readonly PatternIssueRow[],
  options: { sameCategoryCount: number; windowDays: number; now: Date },
  labelFor: (category: string) => string,
): Map<string, CoachingSuggestion> {
  const hits = detectPatterns([...issues], options).filter((hit) => hit.kind === "CLEANER_CATEGORY");
  const cutoff = options.now.getTime() - options.windowDays * DAY_MS;
  const out = new Map<string, CoachingSuggestion>();
  for (const hit of hits) {
    if (!hit.cleanerId || out.has(hit.cleanerId)) continue; // hits are strongest-first
    out.set(hit.cleanerId, {
      category: hit.category,
      label: labelFor(hit.category),
      count: hit.count,
      windowDays: options.windowDays,
      patternKey: hit.patternKey,
      issueIds: issues
        .filter((i) => i.cleanerId === hit.cleanerId && i.category === hit.category && i.createdAt.getTime() >= cutoff)
        .map((i) => i.id),
    });
  }
  return out;
}

export async function loadCleanerSignals(
  cleanerIds: readonly string[],
  labelFor: (category: string) => string,
  now: Date,
): Promise<CleanerSignals> {
  const empty: CleanerSignals = { bonuses: new Map(), openCoaching: new Map(), suggestions: new Map() };
  if (cleanerIds.length === 0) return empty;
  const ids = [...cleanerIds];
  const settings = await getAppSettings();
  const { patternSameCategoryCount, patternWindowDays } = settings.accountability;
  const since = new Date(now.getTime() - patternWindowDays * DAY_MS);

  const [bonusRows, coachingRows, patternRows] = await Promise.all([
    db.cleanerPayAdjustment.findMany({
      where: { cleanerId: { in: ids }, status: PayAdjustmentStatus.PENDING, source: { in: [...BONUS_SOURCES] } },
      select: { id: true, cleanerId: true, title: true, requestedAmount: true, source: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    db.coachingRecord.findMany({
      where: { cleanerId: { in: ids }, status: { in: [...OPEN_COACHING_STATUSES] } },
      select: { cleanerId: true },
    }),
    db.qaIssue.findMany({
      where: { cleanerId: { in: ids }, createdAt: { gte: since } },
      select: { id: true, cleanerId: true, propertyId: true, category: true, severity: true, createdAt: true },
    }),
  ]);

  for (const row of bonusRows) {
    const list = empty.bonuses.get(row.cleanerId) ?? [];
    list.push({
      id: row.id,
      title: row.title ?? "Bonus proposal",
      amount: typeof row.requestedAmount === "number" ? row.requestedAmount : null,
      source: row.source ?? "",
      createdAt: row.createdAt.toISOString(),
    });
    empty.bonuses.set(row.cleanerId, list);
  }
  for (const row of coachingRows) {
    empty.openCoaching.set(row.cleanerId, (empty.openCoaching.get(row.cleanerId) ?? 0) + 1);
  }
  empty.suggestions = strongestPatterns(
    patternRows.map((row) => ({ ...row, severity: String(row.severity) })),
    { sameCategoryCount: patternSameCategoryCount, windowDays: patternWindowDays, now },
    labelFor,
  );
  return empty;
}

export type CleanerAction = "start-coaching" | "review-bonus" | null;

/** One action per row: a recurring pattern without open coaching first, then a waiting bonus. */
export function cleanerAction(input: {
  suggestion: CoachingSuggestion | null;
  openCoaching: number;
  bonuses: number;
}): CleanerAction {
  if (input.suggestion && input.openCoaching === 0) return "start-coaching";
  if (input.bonuses > 0) return "review-bonus";
  return null;
}
