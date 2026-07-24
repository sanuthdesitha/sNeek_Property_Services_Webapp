import { describe, it, expect } from "vitest";
import { qualifiesForAutoPause } from "@/lib/ops/auto-pause";

/**
 * Pure decision coverage for the stale IN_PROGRESS auto-pause sweep.
 * "Running since" = earliest open TimeLog startedAt, else the latest log's
 * startedAt; only IN_PROGRESS jobs older than 24h qualify.
 */

const now = new Date("2026-07-24T10:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

describe("qualifiesForAutoPause", () => {
  it("pauses an IN_PROGRESS job with an open log older than 24h", () => {
    expect(
      qualifiesForAutoPause({
        status: "IN_PROGRESS",
        openLogStartedAt: hoursAgo(25),
        latestLogStartedAt: hoursAgo(25),
        now,
      })
    ).toBe(true);
  });

  it("leaves an IN_PROGRESS job running for less than 24h alone", () => {
    expect(
      qualifiesForAutoPause({
        status: "IN_PROGRESS",
        openLogStartedAt: hoursAgo(23),
        latestLogStartedAt: hoursAgo(23),
        now,
      })
    ).toBe(false);
  });

  it("treats exactly 24h as not yet stale (strictly greater than)", () => {
    expect(
      qualifiesForAutoPause({
        status: "IN_PROGRESS",
        openLogStartedAt: hoursAgo(24),
        latestLogStartedAt: hoursAgo(24),
        now,
      })
    ).toBe(false);
  });

  it("falls back to the latest log when no log is open", () => {
    expect(
      qualifiesForAutoPause({
        status: "IN_PROGRESS",
        openLogStartedAt: null,
        latestLogStartedAt: hoursAgo(30),
        now,
      })
    ).toBe(true);
  });

  it("prefers the open log's start over a newer closed log", () => {
    // The open clock started 25h ago even though a later (closed) log exists.
    expect(
      qualifiesForAutoPause({
        status: "IN_PROGRESS",
        openLogStartedAt: hoursAgo(25),
        latestLogStartedAt: hoursAgo(2),
        now,
      })
    ).toBe(true);
  });

  it("never pauses a job with no time logs at all", () => {
    expect(
      qualifiesForAutoPause({
        status: "IN_PROGRESS",
        openLogStartedAt: null,
        latestLogStartedAt: null,
        now,
      })
    ).toBe(false);
  });

  it("ignores non-IN_PROGRESS statuses regardless of log age", () => {
    for (const status of ["PAUSED", "SUBMITTED", "ASSIGNED", "COMPLETED"]) {
      expect(
        qualifiesForAutoPause({
          status,
          openLogStartedAt: hoursAgo(48),
          latestLogStartedAt: hoursAgo(48),
          now,
        })
      ).toBe(false);
    }
  });
});
