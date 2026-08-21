import { describe, it, expect } from "vitest";
import {
  assessMissedClockIn,
  describeMissedClockIn,
  MISSED_CLOCK_IN_GRACE_MS,
  MAX_BACKDATE_MS,
} from "@/lib/jobs/missed-clock-in";

const NOW = new Date("2026-08-22T03:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

describe("assessMissedClockIn", () => {
  it("says nothing while the clock is running", () => {
    const out = assessMissedClockIn(
      { clockRunning: true, tagTapAt: ago(60 * MIN) },
      NOW
    );
    expect(out.shouldPrompt).toBe(false);
    expect(out.proposedStartAt).toBeNull();
  });

  it("stays quiet during the grace period", () => {
    // Arriving, finding the key and putting bags down must not fire a
    // notification every single time.
    const out = assessMissedClockIn({ clockRunning: false, arrivedAt: ago(3 * MIN) }, NOW);
    expect(out.shouldPrompt).toBe(false);
  });

  it("prompts once someone has been on site past the grace period", () => {
    const out = assessMissedClockIn(
      { clockRunning: false, arrivedAt: ago(MISSED_CLOCK_IN_GRACE_MS + MIN) },
      NOW
    );
    expect(out.shouldPrompt).toBe(true);
    expect(out.evidence).toBe("GEOFENCE");
  });

  it("prefers a tag tap over a geofence hit", () => {
    // A tap is a deliberate act at the door; a geofence hit can be the
    // neighbour's driveway. Strongest source wins even if it is later.
    const out = assessMissedClockIn(
      {
        clockRunning: false,
        arrivedAt: ago(60 * MIN),
        tagTapAt: ago(30 * MIN),
        firstPingAt: ago(90 * MIN),
      },
      NOW
    );
    expect(out.evidence).toBe("NFC_TAG");
    expect(out.proposedStartAt).toEqual(ago(30 * MIN));
  });

  it("falls back to the first ping when nothing better exists", () => {
    const out = assessMissedClockIn({ clockRunning: false, firstPingAt: ago(40 * MIN) }, NOW);
    expect(out.evidence).toBe("FIRST_PING");
    expect(out.shouldPrompt).toBe(true);
  });

  it("has nothing to say without any evidence of arrival", () => {
    const out = assessMissedClockIn({ clockRunning: false }, NOW);
    expect(out.shouldPrompt).toBe(false);
    expect(out.evidence).toBe("NONE");
  });

  it("refuses to backdate a shift to yesterday", () => {
    // A stale arrival stamp must never open a shift in the middle of the night.
    const out = assessMissedClockIn(
      { clockRunning: false, arrivedAt: ago(MAX_BACKDATE_MS + 60 * MIN) },
      NOW
    );
    expect(out.shouldPrompt).toBe(false);
    expect(out.proposedStartAt).toBeNull();
    // Still reports what it saw, so ops can tell this apart from "no data".
    expect(out.evidence).toBe("GEOFENCE");
  });

  it("treats clock skew as just-arrived rather than as time on site", () => {
    const out = assessMissedClockIn(
      { clockRunning: false, arrivedAt: new Date(NOW.getTime() + 5 * MIN) },
      NOW
    );
    expect(out.minutesOnSite).toBe(0);
    expect(out.shouldPrompt).toBe(false);
  });

  it("ignores an unreadable timestamp", () => {
    const out = assessMissedClockIn(
      { clockRunning: false, arrivedAt: new Date("nonsense") },
      NOW
    );
    expect(out.evidence).toBe("NONE");
  });
});

describe("describeMissedClockIn", () => {
  it("names the evidence so the offer can be checked", () => {
    // Being told your shift will be backdated should come with what that claim
    // rests on, so you can say no.
    const out = assessMissedClockIn({ clockRunning: false, tagTapAt: ago(20 * MIN) }, NOW);
    const line = describeMissedClockIn(out);
    expect(line).toContain("tapped the tag");
    expect(line).toContain("20 minutes");
  });

  it("says nothing when there is nothing to prompt", () => {
    expect(describeMissedClockIn(assessMissedClockIn({ clockRunning: true }, NOW))).toBeNull();
  });
});
