import { describe, expect, it } from "vitest";
import { resolveDrop } from "@/lib/calendar/drop";
import { TIME_DROP_STEP_MINUTES, plannedTimeChange, proposedDropStart, trackMinute } from "@/lib/calendar/time-drop";

describe("Day view time drop: proposed start", () => {
  it("snaps the pointer minute, less the grab offset, to the named step", () => {
    expect(TIME_DROP_STEP_MINUTES).toBe(15);
    // 72 px per hour from 06:00: 324 px is 10:30; grabbed 20 min into the chip.
    const minute = trackMinute(324, 6 * 60, 72);
    expect(minute).toBe(630);
    expect(proposedDropStart({ pointerMinute: minute, grabOffsetMinutes: 20 })).toBe("10:15");
    expect(proposedDropStart({ pointerMinute: 637, grabOffsetMinutes: 0 })).toBe("10:30");
    expect(proposedDropStart({ pointerMinute: 644, grabOffsetMinutes: 0 })).toBe("10:45");
  });

  it("keeps the proposal inside the day and proposes nothing off the track", () => {
    expect(proposedDropStart({ pointerMinute: -30, grabOffsetMinutes: 0 })).toBe("00:00");
    expect(proposedDropStart({ pointerMinute: 24 * 60 + 40, grabOffsetMinutes: 0 })).toBe("23:45");
    expect(proposedDropStart({ pointerMinute: null, grabOffsetMinutes: 0 })).toBeNull();
  });
});

describe("plannedTimeChange: the job keeps its length", () => {
  const job = { startTime: "10:00", dueTime: "14:00", endTime: null };
  it("moves the due time by the same amount for a drop or a shift", () => {
    expect(plannedTimeChange(job, { toStartTime: "11:15" })).toEqual({ kind: "change", startTime: "11:15", dueTime: "15:15" });
    expect(plannedTimeChange(job, { shiftMinutes: -60 })).toEqual({ kind: "change", startTime: "09:00", dueTime: "13:00" });
    expect(plannedTimeChange({ ...job, dueTime: null }, { toStartTime: "12:00" })).toEqual({ kind: "change", startTime: "12:00", dueTime: null });
  });

  it("asks for nothing when the time does not change", () => {
    expect(plannedTimeChange(job, {})).toEqual({ kind: "none" });
    expect(plannedTimeChange(job, { toStartTime: "10:00" })).toEqual({ kind: "none" });
    expect(plannedTimeChange(job, { shiftMinutes: 0 })).toEqual({ kind: "none" });
  });

  it("refuses what the reschedule service cannot write or what would leave the day", () => {
    expect(plannedTimeChange({ ...job, endTime: "13:00" }, { toStartTime: "11:00" })).toMatchObject({ kind: "refused", reason: expect.stringMatching(/separate end time \(13:00\)/) });
    expect(plannedTimeChange({ startTime: null, dueTime: null, endTime: null }, { shiftMinutes: 30 })).toMatchObject({ kind: "refused", reason: expect.stringMatching(/no start time to shift/) });
    expect(plannedTimeChange(job, { toStartTime: "21:00" })).toMatchObject({ kind: "refused", reason: expect.stringMatching(/after midnight/) });
    expect(plannedTimeChange(job, { shiftMinutes: -11 * 60 })).toMatchObject({ kind: "refused", reason: expect.stringMatching(/another day/) });
  });
});

describe("resolveDrop with a proposed time", () => {
  const source = { lane: "cleaner" as const, rowId: "u1", day: "2026-11-11" };
  it("turns a same-row drop at another hour into a time move", () => {
    expect(resolveDrop(source, { ...source, minute: 700 }, { currentStart: "10:00", proposedStart: "11:30" }))
      .toEqual({ kind: "move", toDate: "2026-11-11", fromCleanerId: null, toCleanerId: null, toStartTime: "11:30" });
  });
  it("combines a time with a cleaner change and ignores an unchanged time", () => {
    expect(resolveDrop(source, { ...source, rowId: "u2" }, { currentStart: "10:00", proposedStart: "12:00" }))
      .toEqual({ kind: "move", toDate: "2026-11-11", fromCleanerId: "u1", toCleanerId: "u2", toStartTime: "12:00" });
    expect(resolveDrop(source, source, { currentStart: "10:00", proposedStart: "10:00" })).toEqual({ kind: "none" });
  });
});
