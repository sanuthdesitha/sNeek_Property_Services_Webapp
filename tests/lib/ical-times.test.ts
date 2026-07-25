import { describe, it, expect } from "vitest";
import { resolveJobTimesFromReservation } from "@/lib/ical/times";
import type { JobTimingRule } from "@/lib/jobs/meta";

const off: JobTimingRule = { enabled: false, preset: "none" };
const late1230: JobTimingRule = { enabled: true, preset: "12:30", time: "12:30" };
const early1100: JobTimingRule = { enabled: true, preset: "11:00", time: "11:00" };

describe("resolveJobTimesFromReservation", () => {
  it("passes raw reservation times through when no rules are set", () => {
    expect(
      resolveJobTimesFromReservation({
        reservationStartTime: "10:00",
        reservationDueTime: "15:00",
        earlyCheckin: off,
        lateCheckout: off,
      })
    ).toEqual({ startTime: "10:00", dueTime: "15:00" });
  });

  it("late-checkout rule overrides the reservation-derived startTime", () => {
    expect(
      resolveJobTimesFromReservation({
        reservationStartTime: "10:00",
        reservationDueTime: "15:00",
        earlyCheckin: off,
        lateCheckout: late1230,
      })
    ).toEqual({ startTime: "12:30", dueTime: "15:00" });
  });

  it("early-checkin rule overrides the reservation-derived dueTime", () => {
    expect(
      resolveJobTimesFromReservation({
        reservationStartTime: "10:00",
        reservationDueTime: "15:00",
        earlyCheckin: early1100,
        lateCheckout: off,
      })
    ).toEqual({ startTime: "10:00", dueTime: "11:00" });
  });

  it("applies both rules together", () => {
    expect(
      resolveJobTimesFromReservation({
        reservationStartTime: "10:00",
        reservationDueTime: "15:00",
        earlyCheckin: early1100,
        lateCheckout: late1230,
      })
    // Conflict clamp inside applyJobTimingRules: due (11:00) < start (12:30)
    // → due is clamped to the start time.
    ).toEqual({ startTime: "12:30", dueTime: "12:30" });
  });

  it("uses a custom rule time", () => {
    expect(
      resolveJobTimesFromReservation({
        reservationStartTime: "10:00",
        reservationDueTime: "18:00",
        earlyCheckin: { enabled: true, preset: "custom", time: "13:45" },
        lateCheckout: off,
      })
    ).toEqual({ startTime: "10:00", dueTime: "13:45" });
  });

  it("ignores disabled rules even when a time is present", () => {
    expect(
      resolveJobTimesFromReservation({
        reservationStartTime: "10:00",
        reservationDueTime: "15:00",
        earlyCheckin: { enabled: false, preset: "11:00", time: "11:00" },
        lateCheckout: { enabled: false, preset: "12:30", time: "12:30" },
      })
    ).toEqual({ startTime: "10:00", dueTime: "15:00" });
  });

  it("keeps null/undefined raw times as null when no rules apply", () => {
    expect(
      resolveJobTimesFromReservation({
        reservationStartTime: null,
        reservationDueTime: undefined,
        earlyCheckin: off,
        lateCheckout: off,
      })
    ).toEqual({ startTime: null, dueTime: null });
  });

  it("falls back to the raw value when a time is not strict HH:MM", () => {
    expect(
      resolveJobTimesFromReservation({
        reservationStartTime: "9:00", // not HH:MM — normalizer rejects it
        reservationDueTime: "15:00",
        earlyCheckin: off,
        lateCheckout: off,
      })
    ).toEqual({ startTime: "9:00", dueTime: "15:00" });
  });
});
