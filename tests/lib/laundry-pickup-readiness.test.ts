import { describe, it, expect } from "vitest";
import {
  pickupNeedsReadinessAnswer,
  buildLaundryQaPenalties,
  describePickupReadiness,
  readPickupReadiness,
  resolvePickupReadinessFromConfirmations,
  LAUNDRY_NOT_READY_PENALTY_POINTS,
  LAUNDRY_UNCONFIRMED_PENALTY_POINTS,
} from "@/lib/laundry/pickup-readiness";

describe("pickupNeedsReadinessAnswer", () => {
  it("asks when the cleaner never confirmed", () => {
    expect(pickupNeedsReadinessAnswer("PENDING")).toBe(true);
  });

  it("does not ask on a confirmed task", () => {
    // A question answered the same way ninety times stops being read, and the
    // ninety-first is the one that matters.
    expect(pickupNeedsReadinessAnswer("CONFIRMED")).toBe(false);
  });
});

describe("buildLaundryQaPenalties", () => {
  it("costs the most when the linen was not there", () => {
    const [penalty] = buildLaundryQaPenalties({
      cleanerConfirmed: false,
      driverAnswer: "NOT_READY",
    });
    expect(penalty.points).toBe(LAUNDRY_NOT_READY_PENALTY_POINTS);
    expect(penalty.label).toMatch(/not ready/i);
  });

  it("still penalises a cleaner who left it ready but never marked it", () => {
    // The work was done, so this is the cheaper miss — but not free: a driver
    // planned a route on information that did not exist.
    const [penalty] = buildLaundryQaPenalties({
      cleanerConfirmed: false,
      driverAnswer: "READY",
    });
    expect(penalty.points).toBe(LAUNDRY_UNCONFIRMED_PENALTY_POINTS);
    expect(penalty.points).toBeLessThan(LAUNDRY_NOT_READY_PENALTY_POINTS);
  });

  it("charges nothing on the normal path", () => {
    expect(
      buildLaundryQaPenalties({ cleanerConfirmed: true, driverAnswer: "READY" })
    ).toEqual([]);
  });

  it("penalises a false confirmation harder, not softer", () => {
    // Ticking "ready" for linen that is not there is worse than forgetting to
    // tick at all. Letting the confirmation suppress the penalty would reward it.
    const [penalty] = buildLaundryQaPenalties({
      cleanerConfirmed: true,
      driverAnswer: "NOT_READY",
    });
    expect(penalty.points).toBe(LAUNDRY_NOT_READY_PENALTY_POINTS);
    expect(penalty.label).toMatch(/marked ready/i);
  });

  it("never penalises on an absence of evidence", () => {
    // A driver who was never asked tells us nothing. Scoring cleaners on that
    // would score them on which driver happened to run the route.
    expect(buildLaundryQaPenalties({ cleanerConfirmed: false, driverAnswer: null })).toEqual([]);
    expect(buildLaundryQaPenalties({ cleanerConfirmed: true, driverAnswer: null })).toEqual([]);
  });
});

describe("describePickupReadiness", () => {
  it("attributes the report to the driver, not the cleaner", () => {
    const line = describePickupReadiness({ cleanerConfirmed: false, driverAnswer: "NOT_READY" });
    expect(line).toMatch(/driver/i);
  });

  it("says nothing when there is nothing to report", () => {
    expect(describePickupReadiness({ cleanerConfirmed: true, driverAnswer: "READY" })).toBeNull();
    expect(describePickupReadiness({ cleanerConfirmed: false, driverAnswer: null })).toBeNull();
  });
});

describe("readPickupReadiness", () => {
  it("reads the answer out of a stored JSON string", () => {
    expect(readPickupReadiness('{"event":"PICKED_UP","pickupReadiness":"NOT_READY"}')).toBe(
      "NOT_READY"
    );
  });

  it("treats anything unrecognised as not answered", () => {
    expect(readPickupReadiness('{"pickupReadiness":"MAYBE"}')).toBeNull();
    expect(readPickupReadiness("not json at all")).toBeNull();
    expect(readPickupReadiness(null)).toBeNull();
    expect(readPickupReadiness(undefined)).toBeNull();
  });
});

describe("resolvePickupReadinessFromConfirmations", () => {
  const row = (event: string, readiness: string | null, createdAt: string) => ({
    notes: JSON.stringify({
      event,
      ...(readiness ? { pickupReadiness: readiness } : {}),
    }),
    createdAt,
  });

  it("ignores rows for other events", () => {
    expect(
      resolvePickupReadinessFromConfirmations([
        row("DROPPED", "NOT_READY", "2026-08-21T05:00:00.000Z"),
      ])
    ).toBeNull();
  });

  it("returns the same answer whichever order the caller fetched in", () => {
    // The real bug this guards: callers in this repo fetch confirmations both
    // ascending and descending. Trusting array order would make one function
    // give two different answers for the same task.
    const older = row("PICKED_UP", "NOT_READY", "2026-08-21T02:00:00.000Z");
    const newer = row("PICKED_UP", "READY", "2026-08-21T06:00:00.000Z");
    expect(resolvePickupReadinessFromConfirmations([older, newer])).toBe("READY");
    expect(resolvePickupReadinessFromConfirmations([newer, older])).toBe("READY");
  });

  it("returns null when nothing was answered", () => {
    expect(
      resolvePickupReadinessFromConfirmations([
        row("PICKED_UP", null, "2026-08-21T02:00:00.000Z"),
      ])
    ).toBeNull();
    expect(resolvePickupReadinessFromConfirmations(null)).toBeNull();
    expect(resolvePickupReadinessFromConfirmations([])).toBeNull();
  });
});
