/**
 * Which published version of the scheduling rules applies — PURE (no IO).
 *
 * - A version becomes live at the START of its `effectiveFrom` Sydney day.
 *   Version 1 ("Original") is live from the beginning of time.
 * - LIVE rules (`live`): the highest version already effective. New runs and
 *   new jobs, and every run-time sweep, use these.
 * - An EXISTING run or job (`forItem(createdAt)`) keeps the rules it was
 *   planned with: the highest effective version that was already live when the
 *   item was created — unless a later effective version was published with
 *   "re-plan existing" (`appliesToExisting`), which then applies to it too.
 *
 * So publishing never moves work that already exists unless the publisher
 * explicitly ticked "re-plan these", and past days are never re-planned (the
 * planner and the iCal sync already start from today).
 */
import { sydneyDayStart, sydneyTodayKey } from "@/lib/time/sydney-range";
import type { SchedulingRuleValues } from "./values";

export const ORIGINAL_EFFECTIVE_FROM = "2000-01-01";

export type RuleVersionKind = "ORIGINAL" | "EDIT" | "RESTORE" | "IMPORT";

export type RuleVersionRecord = {
  version: number;
  kind: RuleVersionKind;
  values: SchedulingRuleValues;
  effectiveFrom: string;
  appliesToExisting: boolean;
  reason: string;
  restoredFromVersion: number | null;
  createdById: string | null;
  createdAt: Date;
  activatedAt: Date | null;
  checksum: string;
  schemaVersion: number;
};

export function effectiveInstant(record: Pick<RuleVersionRecord, "effectiveFrom">): Date {
  return record.effectiveFrom <= ORIGINAL_EFFECTIVE_FROM ? new Date(0) : sydneyDayStart(record.effectiveFrom);
}

export type RuleBook = {
  versions: RuleVersionRecord[];
  live: RuleVersionRecord;
  /** Versions published but not yet effective (scheduled for a later day). */
  scheduled: RuleVersionRecord[];
  forItem(createdAt: Date | null | undefined): RuleVersionRecord;
};

/** Build the book from every stored version (any order). Throws when there is no version 1. */
export function buildRuleBook(records: RuleVersionRecord[], now: Date = new Date()): RuleBook {
  const versions = [...records].sort((a, b) => a.version - b.version);
  const effective = versions.filter((record) => effectiveInstant(record).getTime() <= now.getTime());
  if (effective.length === 0 || versions[0]?.version !== 1) {
    throw new Error("The scheduling rules have no original version.");
  }
  const live = effective[effective.length - 1];
  const scheduled = versions.filter((record) => effectiveInstant(record).getTime() > now.getTime());
  return {
    versions,
    live,
    scheduled,
    forItem(createdAt) {
      if (!createdAt) return live;
      const created = createdAt.getTime();
      let chosen = effective[0];
      for (const record of effective) {
        if (effectiveInstant(record).getTime() <= created || record.appliesToExisting) chosen = record;
      }
      return chosen;
    },
  };
}

/** The earliest day a new version may take effect: tomorrow in Sydney. */
export function earliestEffectiveFrom(now: Date = new Date()): string {
  const today = sydneyTodayKey(now);
  const next = new Date(`${today}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
