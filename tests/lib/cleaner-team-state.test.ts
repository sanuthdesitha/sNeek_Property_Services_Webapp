import { describe, it, expect } from "vitest";
import {
  isTeamStarted,
  isTeamActive,
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

/**
 * Regression: admin moves a started job IN_PROGRESS → ASSIGNED and hands it to a
 * different cleaner. The previous cleaner's time log and the immutable job-level
 * gpsCheckInAt survive, so the old predicate reported "already started" and the
 * workspace hid the start verification — while the server's start route still
 * demanded the confirmations from the new cleaner (they have no time log of
 * their own). The new assignee could neither start nor submit.
 */
describe("team-state — job bounced back to ASSIGNED and reassigned", () => {
  const freshAssigneeOnRestartedJob = {
    // Admin already moved it back; the old cleaner's log is still on the job.
    jobStatus: "ASSIGNED",
    anyTeamTimeLog: true,
    ownRunning: false,
    ownCompletedSeconds: 0,
  };

  it("the stale team time log does NOT count as an active clean", () => {
    expect(isTeamStarted(freshAssigneeOnRestartedJob)).toBe(true); // stale-truthy by design
    expect(isTeamActive(freshAssigneeOnRestartedJob)).toBe(false);
  });

  it("the new assignee IS asked for their own start verification", () => {
    expect(
      requiresStartConfirmations({ ...freshAssigneeOnRestartedJob, requireStartConfirmation: true })
    ).toBe(true);
  });

  it("a leftover job-level GPS check-in does not bypass the gate", () => {
    expect(
      requiresStartConfirmations({
        ...freshAssigneeOnRestartedJob,
        requireStartConfirmation: true,
        hasJobCheckIn: true,
      })
    ).toBe(true);
  });

  it("once they clock in themselves, the gate stops asking", () => {
    expect(
      requiresStartConfirmations({
        ...freshAssigneeOnRestartedJob,
        jobStatus: "IN_PROGRESS",
        ownRunning: true,
        requireStartConfirmation: true,
      })
    ).toBe(false);
  });

  it("does NOT regress the teammate case: joining a genuinely running clean skips re-verification", () => {
    const teammateJoining = {
      jobStatus: "IN_PROGRESS",
      anyTeamTimeLog: true,
      ownRunning: false,
      ownCompletedSeconds: 0,
    };
    expect(isTeamActive(teammateJoining)).toBe(true);
    expect(requiresStartConfirmations({ ...teammateJoining, requireStartConfirmation: true })).toBe(false);
    expect(isStartedForVisibility(teammateJoining)).toBe(true);
    // PAUSED (someone clocked out mid-clean) is still an active team clean.
    expect(isTeamActive({ ...teammateJoining, jobStatus: "PAUSED" })).toBe(true);
    expect(
      requiresStartConfirmations({ ...teammateJoining, jobStatus: "PAUSED", requireStartConfirmation: true })
    ).toBe(false);
  });

  it("an IN_PROGRESS job with nobody on the clock still gates the first starter", () => {
    expect(
      requiresStartConfirmations({
        jobStatus: "IN_PROGRESS",
        anyTeamTimeLog: false,
        ownRunning: false,
        ownCompletedSeconds: 0,
        requireStartConfirmation: true,
      })
    ).toBe(true);
  });
});
