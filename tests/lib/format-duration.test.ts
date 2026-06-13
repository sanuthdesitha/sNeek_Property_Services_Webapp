import { describe, expect, it } from "vitest";
import {
  elapsedSecondsSince,
  formatDuration,
  formatElapsedShort,
  safeSeconds,
} from "@/lib/time/format-duration";

describe("safeSeconds", () => {
  it("clamps NaN, negatives, and non-numbers to 0", () => {
    expect(safeSeconds(Number.NaN)).toBe(0);
    expect(safeSeconds(-5)).toBe(0);
    expect(safeSeconds(undefined)).toBe(0);
    expect(safeSeconds("oops")).toBe(0);
    expect(safeSeconds(Infinity)).toBe(0);
  });

  it("floors fractional seconds", () => {
    expect(safeSeconds(61.9)).toBe(61);
  });
});

describe("formatDuration", () => {
  it("formats hours/minutes/seconds with padding", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(59)).toBe("00:00:59");
    expect(formatDuration(3600 + 23 * 60 + 45)).toBe("01:23:45");
    expect(formatDuration(26 * 3600)).toBe("26:00:00");
  });

  it("never returns NaN for invalid input", () => {
    expect(formatDuration(Number.NaN)).toBe("00:00:00");
    expect(formatDuration(-100)).toBe("00:00:00");
  });
});

describe("formatElapsedShort", () => {
  it("renders minutes only under an hour", () => {
    expect(formatElapsedShort(45 * 60)).toBe("45m");
  });

  it("renders hours and minutes above an hour", () => {
    expect(formatElapsedShort(3600 + 23 * 60)).toBe("1h 23m");
  });

  it("handles invalid input", () => {
    expect(formatElapsedShort(Number.NaN)).toBe("0m");
  });
});

describe("elapsedSecondsSince", () => {
  const now = Date.parse("2026-06-13T10:00:00.000Z");

  it("derives elapsed seconds from a server startedAt", () => {
    expect(elapsedSecondsSince("2026-06-13T09:30:00.000Z", 0, now)).toBe(1800);
  });

  it("adds banked completed seconds", () => {
    expect(elapsedSecondsSince("2026-06-13T09:30:00.000Z", 600, now)).toBe(2400);
  });

  it("returns banked seconds for null startedAt", () => {
    expect(elapsedSecondsSince(null, 600, now)).toBe(600);
  });

  it("returns banked seconds for an invalid date string", () => {
    expect(elapsedSecondsSince("not-a-date", 120, now)).toBe(120);
  });

  it("never goes negative when startedAt is in the future (clock skew)", () => {
    expect(elapsedSecondsSince("2026-06-13T11:00:00.000Z", 300, now)).toBe(300);
  });
});
