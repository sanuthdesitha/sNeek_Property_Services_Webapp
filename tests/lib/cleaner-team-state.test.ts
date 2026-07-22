import { describe, it, expect } from "vitest";
import {
  isTeamStarted,
  isOwnStarted,
  isStartedForVisibility,
  requiresStartConfirmations,
} from "@/lib/cleaner/team-state";

// Regression: cleaner B was pinned on Set-up behind "complete the start
// verification" once cleaner A started, because started-ness was own-only.
describe("team-state — two cleaners on one job", () => {
  const bOpensJobAStarted = {
    jobStatus: "IN_PROGRESS",
    anyTeamTimeLog: true,
    ownRunning: false,
    ownCompletedSeconds: 0,
  };

  it("team is started when the job is IN_PROGRESS even if I haven't clocked in", () => {
    expect(isTeamStarted(bOpensJobAStarted)).toBe(true);
    expect(isOwnStarted(bOpensJobAStarted)).toBe(false);
  });

  it("visibility unlocks for the second cleaner (the actual bug)", () => {
    expect(isStartedForVisibility(bOpensJobAStarted)).toBe(true);
  });

  it("the second cleaner is NOT forced through the start confirmations again", () => {
    expect(requiresStartConfirmations({ ...bOpensJobAStarted, requireStartConfirmation: true })).toBe(false);
  });

  it("but the second cleaner still has their own clock to start (pay stays personal)", () => {
    expect(isOwnStarted(bOpensJobAStarted)).toBe(false);
  });
});

describe("team-state — first starter", () => {
  const fresh = { jobStatus: "ASSIGNED", anyTeamTimeLog: false, ownRunning: false, ownCompletedSeconds: 0 };

  it("nobody started → not visible-started, confirmations required", () => {
    expect(isTeamStarted(fresh)).toBe(false);
    expect(isStartedForVisibility(fresh)).toBe(false);
    expect(requiresStartConfirmations({ ...fresh, requireStartConfirmation: true })).toBe(true);
  });

  it("PAUSED counts as team-started (job resumed later, not a fresh start)", () => {
    expect(isTeamStarted({ ...fresh, jobStatus: "PAUSED" })).toBe(true);
  });

  it("a team time log alone counts even if status lags", () => {
    expect(isTeamStarted({ ...fresh, anyTeamTimeLog: true })).toBe(true);
  });

  it("own completed seconds count as own-started (returning after clock-out)", () => {
    expect(isOwnStarted({ ...fresh, ownCompletedSeconds: 1800 })).toBe(true);
    expect(requiresStartConfirmations({ ...fresh, ownCompletedSeconds: 1800, requireStartConfirmation: true })).toBe(false);
  });

  it("confirmations are skipped when disabled, locked, or acceptance pending", () => {
    expect(requiresStartConfirmations({ ...fresh, requireStartConfirmation: false })).toBe(false);
    expect(requiresStartConfirmations({ ...fresh, requireStartConfirmation: true, locked: true })).toBe(false);
    expect(requiresStartConfirmations({ ...fresh, requireStartConfirmation: true, needsAcceptance: true })).toBe(false);
  });
});
