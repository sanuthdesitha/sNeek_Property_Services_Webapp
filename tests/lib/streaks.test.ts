import { describe, it, expect } from "vitest";
import {
  computeStreak,
  evaluateStreakBonuses,
  evaluateMonthlyRanking,
  type CleanRecord,
  type MonthlyRankingRow,
} from "@/lib/accountability/streaks";
import type { AccountabilityBonusSettings } from "@/lib/settings";

const BONUSES: AccountabilityBonusSettings = {
  streakLength: 5,
  streakAmount: 20,
  extendedStreakLength: 10,
  extendedStreakAmount: 40,
  streakMinScore: 97,
  monthlyFirstAmount: 75,
  monthlySecondAmount: 40,
  monthlyMinCleans: 10,
  monthlyMinAvgScore: 95,
};

/** A qualifying clean (score ≥ 97, no critical/complaint/missing-evidence). */
function good(score = 98): CleanRecord {
  return { score, hadCritical: false, hadComplaint: false, hadMissingEvidence: false };
}

describe("computeStreak", () => {
  it("counts all qualifying cleans", () => {
    expect(computeStreak([good(), good(), good()], 97)).toBe(3);
  });

  it("returns 0 for an empty list", () => {
    expect(computeStreak([], 97)).toBe(0);
  });

  it("stops at the first low score (newest-first order)", () => {
    // most recent qualifies, then two more, then a low one → streak 3
    const cleans = [good(), good(), good(), good(94), good()];
    expect(computeStreak(cleans, 97)).toBe(3);
  });

  it("breaks on a critical issue", () => {
    const cleans = [good(), { ...good(), hadCritical: true }, good()];
    expect(computeStreak(cleans, 97)).toBe(1);
  });

  it("breaks on a client complaint", () => {
    const cleans = [good(), good(), { ...good(), hadComplaint: true }, good()];
    expect(computeStreak(cleans, 97)).toBe(2);
  });

  it("breaks on missing evidence", () => {
    const cleans = [{ ...good(), hadMissingEvidence: true }, good()];
    expect(computeStreak(cleans, 97)).toBe(0);
  });

  it("treats a null score as non-qualifying", () => {
    const cleans = [good(), { ...good(), score: null }, good()];
    expect(computeStreak(cleans, 97)).toBe(1);
  });

  it("respects the minScore threshold boundary (>= is inclusive)", () => {
    expect(computeStreak([good(97)], 97)).toBe(1);
    expect(computeStreak([good(96)], 97)).toBe(0);
  });
});

describe("evaluateStreakBonuses", () => {
  const cid = "cleaner-1";
  const job = "job-anchor";

  it("proposes the streak-5 bonus at exactly 5", () => {
    const out = evaluateStreakBonuses(5, new Set(), cid, job, BONUSES);
    expect(out).toEqual([
      { source: "STREAK_5", sourceKey: `streak5:${cid}:${job}`, amount: 20 },
    ]);
  });

  it("proposes nothing at 4", () => {
    expect(evaluateStreakBonuses(4, new Set(), cid, job, BONUSES)).toEqual([]);
  });

  it("proposes only the +$40 streak-10 bonus at exactly 10 (not streak-5)", () => {
    const out = evaluateStreakBonuses(10, new Set(), cid, job, BONUSES);
    expect(out).toEqual([
      { source: "STREAK_10", sourceKey: `streak10:${cid}:${job}`, amount: 40 },
    ]);
  });

  it("proposes nothing at 6 when nothing new crosses a threshold", () => {
    const out = evaluateStreakBonuses(6, new Set([`streak5:${cid}:${job}`]), cid, job, BONUSES);
    expect(out).toEqual([]);
  });

  it("skips a key already awarded (dedupe)", () => {
    const already = new Set([`streak5:${cid}:${job}`]);
    expect(evaluateStreakBonuses(5, already, cid, job, BONUSES)).toEqual([]);
  });

  it("skips the streak-10 key when already awarded", () => {
    const already = new Set([`streak10:${cid}:${job}`]);
    expect(evaluateStreakBonuses(10, already, cid, job, BONUSES)).toEqual([]);
  });
});

describe("evaluateMonthlyRanking", () => {
  const month = "2026-07";

  it("ranks #1 and #2 by avgScore desc with correct amounts", () => {
    const rows: MonthlyRankingRow[] = [
      { cleanerId: "a", cleans: 12, avgScore: 96 },
      { cleanerId: "b", cleans: 15, avgScore: 98 },
      { cleanerId: "c", cleans: 11, avgScore: 97 },
    ];
    const out = evaluateMonthlyRanking(rows, month, BONUSES);
    expect(out).toEqual([
      { cleanerId: "b", source: "MONTHLY_RANK_1", sourceKey: "monthly:2026-07:1", amount: 75 },
      { cleanerId: "c", source: "MONTHLY_RANK_2", sourceKey: "monthly:2026-07:2", amount: 40 },
    ]);
  });

  it("filters out cleaners below the min-cleans / min-avg gates", () => {
    const rows: MonthlyRankingRow[] = [
      { cleanerId: "lowvol", cleans: 9, avgScore: 99 }, // too few cleans
      { cleanerId: "lowqual", cleans: 20, avgScore: 94 }, // avg below 95
      { cleanerId: "ok", cleans: 10, avgScore: 95 }, // exactly on the gates
    ];
    const out = evaluateMonthlyRanking(rows, month, BONUSES);
    expect(out).toHaveLength(1);
    expect(out[0].cleanerId).toBe("ok");
    expect(out[0].source).toBe("MONTHLY_RANK_1");
  });

  it("breaks ties by more cleans", () => {
    const rows: MonthlyRankingRow[] = [
      { cleanerId: "fewer", cleans: 11, avgScore: 97 },
      { cleanerId: "more", cleans: 18, avgScore: 97 },
    ];
    const out = evaluateMonthlyRanking(rows, month, BONUSES);
    expect(out[0].cleanerId).toBe("more");
    expect(out[1].cleanerId).toBe("fewer");
  });

  it("produces only a #1 proposal when a single cleaner is eligible", () => {
    const rows: MonthlyRankingRow[] = [
      { cleanerId: "solo", cleans: 12, avgScore: 96 },
      { cleanerId: "nope", cleans: 3, avgScore: 99 },
    ];
    const out = evaluateMonthlyRanking(rows, month, BONUSES);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("MONTHLY_RANK_1");
  });

  it("produces nothing when no cleaner is eligible", () => {
    const rows: MonthlyRankingRow[] = [{ cleanerId: "x", cleans: 2, avgScore: 80 }];
    expect(evaluateMonthlyRanking(rows, month, BONUSES)).toEqual([]);
  });
});
