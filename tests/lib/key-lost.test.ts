/**
 * Key-lost laundry scheduling — both sides of the single branch point:
 *
 * 1. The KEY_LOST branch: while a property's spare key is lost, pickup AND
 *    drop-off are scheduled ON the cleaning day at 10:00 (12:30 when the job
 *    has a late checkout), tagged KEY_LOST.
 * 2. The NORMAL path regression snapshot: with keyLostMode=false,
 *    computeDraftItem must produce EXACTLY what it produced before key-lost
 *    mode existed. The expected values below were transcribed from reading
 *    lib/laundry/planner.ts — they encode the "normal path is bit-for-bit
 *    unchanged" guarantee. If one of these fails, the precious normal
 *    scheduling behaviour changed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { format } from "date-fns";

const findFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    job: {
      findFirst: (...args: unknown[]) => findFirst(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// planner.ts imports the sync-draft store (which pulls notifications/S3/etc.);
// none of it is exercised by computeDraftItem.
vi.mock("@/lib/laundry/sync-draft", () => ({
  replacePendingLaundrySyncDraftForProperty: vi.fn(),
  notifyLaundryTeamsForApprovedSyncDraft: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(),
}));

import { computeDraftItem } from "@/lib/laundry/planner";
import { computeKeyLostDraftItem, isKeyLostNotes, KEY_LOST_TAG } from "@/lib/laundry/key-lost";
import { atTimeOnDay, hasLateCheckout, resolveKeyLostServiceTime } from "@/lib/laundry/clean-start";

/** Local-midnight day helper — matches the planner's date-fns startOfDay normalization. */
function day(offset = 0) {
  return new Date(2026, 7, 10 + offset); // 10 Aug 2026, local midnight
}
function iso(d: Date) {
  return d.toISOString();
}
/** Local wall-clock instant on the clean day — matches atTimeOnDay(setHours). */
function at(h: number, m: number, offset = 0) {
  return new Date(2026, 7, 10 + offset, h, m, 0, 0).toISOString();
}

const LATE_CHECKOUT_NOTES = JSON.stringify({
  version: 1,
  lateCheckout: { enabled: true, preset: "12:30" },
});

function makeJob(overrides: Record<string, unknown> = {}, property: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    propertyId: "prop-1",
    scheduledDate: day(0),
    startTime: null,
    internalNotes: null,
    property: {
      id: "prop-1",
      name: "Harbour Villa",
      suburb: "Manly",
      linenBufferSets: 1,
      keyLostMode: false,
      defaultCheckoutTime: "10:00",
      ...property,
    },
    ...overrides,
  } as any;
}

const OPS = {
  pickupCutoffTime: "16:00",
  defaultPickupTime: "10:00",
  defaultDropoffTime: "14:00",
  maxOutdoorDays: 5,
  fastReturnWhenNoNextClean: true,
  fastReturnDaysWhenNoNextClean: 2,
} as any;

beforeEach(() => {
  findFirst.mockReset();
  findFirst.mockResolvedValue(null);
});

describe("key-lost service time rules", () => {
  it("normal checkout → 10:00, late checkout → 12:30", () => {
    expect(resolveKeyLostServiceTime(makeJob())).toBe("10:00");
    expect(hasLateCheckout(makeJob())).toBe(false);
    const late = makeJob({ internalNotes: LATE_CHECKOUT_NOTES });
    expect(hasLateCheckout(late)).toBe(true);
    expect(resolveKeyLostServiceTime(late)).toBe("12:30");
  });

  it("atTimeOnDay applies LOCAL wall-clock hours (what the boards render)", () => {
    const stamped = atTimeOnDay(day(0), "12:30");
    expect(format(stamped, "HH:mm")).toBe("12:30");
    expect(format(stamped, "yyyy-MM-dd")).toBe("2026-08-10");
  });
});

describe("computeKeyLostDraftItem", () => {
  it("schedules pickup AND drop-off on the clean day at 10:00 (normal checkout)", () => {
    const item = computeKeyLostDraftItem(makeJob({}, { keyLostMode: true }));
    expect(item.cleanDate).toBe(iso(day(0)));
    expect(item.pickupDate).toBe(at(10, 0));
    expect(item.dropoffDate).toBe(at(10, 0));
    expect(item.pickupDate).toBe(item.dropoffDate);
    expect(item.scenario).toBe("KEY_LOST");
    expect(item.status).toBe("PENDING");
    expect(item.flagReason).toBeNull();
    expect(item.flagNotes).toContain(KEY_LOST_TAG);
    expect(isKeyLostNotes(item.flagNotes)).toBe(true);
  });

  it("uses 12:30 when the job has a late checkout", () => {
    const item = computeKeyLostDraftItem(
      makeJob({ internalNotes: LATE_CHECKOUT_NOTES }, { keyLostMode: true })
    );
    expect(item.pickupDate).toBe(at(12, 30));
    expect(item.dropoffDate).toBe(at(12, 30));
    expect(item.flagNotes).toContain("12:30");
    expect(item.scenario).toBe("KEY_LOST");
  });
});

describe("computeDraftItem — key-lost branch point", () => {
  it("routes to the key-lost item when property.keyLostMode is on (no db lookups)", async () => {
    const job = makeJob({}, { keyLostMode: true });
    const item = await computeDraftItem(job, OPS);
    expect(item).toEqual(computeKeyLostDraftItem(job));
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("computeDraftItem — NORMAL PATH REGRESSION SNAPSHOT (keyLostMode=false)", () => {
  it("BACK_TO_BACK with no buffer linen → FLAGGED EXPRESS_OR_EXTRA_LINEN_REQUIRED", async () => {
    findFirst.mockResolvedValue({ scheduledDate: day(1) });
    const item = await computeDraftItem(makeJob({}, { linenBufferSets: 0 }), OPS);
    expect(item).toEqual({
      jobId: "job-1",
      propertyId: "prop-1",
      propertyName: "Harbour Villa",
      suburb: "Manly",
      cleanDate: iso(day(0)),
      pickupDate: iso(day(1)), // clean + 1
      dropoffDate: iso(day(2)), // earliest valid: pickup + 1 (preferred day(0) is too early)
      status: "FLAGGED",
      flagReason: "EXPRESS_OR_EXTRA_LINEN_REQUIRED",
      flagNotes: "Back-to-back clean dates with no buffer linen set configured.",
      scenario: "BACK_TO_BACK",
      linenBufferSets: 0,
    });
  });

  it("BACK_TO_BACK with buffer linen → PENDING, tight-gap note", async () => {
    findFirst.mockResolvedValue({ scheduledDate: day(1) });
    const item = await computeDraftItem(makeJob({}, { linenBufferSets: 2 }), OPS);
    expect(item).toEqual({
      jobId: "job-1",
      propertyId: "prop-1",
      propertyName: "Harbour Villa",
      suburb: "Manly",
      cleanDate: iso(day(0)),
      pickupDate: iso(day(1)),
      dropoffDate: iso(day(2)),
      status: "PENDING",
      flagReason: null,
      flagNotes: "Tight gap detected; returning on the earliest valid date after 24h.",
      scenario: "BACK_TO_BACK",
      linenBufferSets: 2,
    });
  });

  it("MICRO_CYCLE (gap 3) → return the day before the next clean", async () => {
    findFirst.mockResolvedValue({ scheduledDate: day(3) });
    const item = await computeDraftItem(makeJob(), OPS);
    expect(item).toEqual({
      jobId: "job-1",
      propertyId: "prop-1",
      propertyName: "Harbour Villa",
      suburb: "Manly",
      cleanDate: iso(day(0)),
      pickupDate: iso(day(1)),
      dropoffDate: iso(day(2)), // nextClean − 1
      status: "PENDING",
      flagReason: null,
      flagNotes: "Return scheduled for the day before the next known clean.",
      scenario: "MICRO_CYCLE",
      linenBufferSets: 1,
    });
  });

  it("COMPRESSED (gap 6) → return the day before the next clean", async () => {
    findFirst.mockResolvedValue({ scheduledDate: day(6) });
    const item = await computeDraftItem(makeJob(), OPS);
    expect(item.scenario).toBe("COMPRESSED");
    expect(item.pickupDate).toBe(iso(day(1)));
    expect(item.dropoffDate).toBe(iso(day(5)));
    expect(item.status).toBe("PENDING");
    expect(item.flagReason).toBeNull();
    expect(item.flagNotes).toBe("Return scheduled for the day before the next known clean.");
  });

  it("no next clean + fast-return ON → pickup+fastReturnDays (capped)", async () => {
    findFirst.mockResolvedValue(null);
    const item = await computeDraftItem(makeJob(), OPS);
    expect(item).toEqual({
      jobId: "job-1",
      propertyId: "prop-1",
      propertyName: "Harbour Villa",
      suburb: "Manly",
      cleanDate: iso(day(0)),
      pickupDate: iso(day(1)),
      dropoffDate: iso(day(3)), // pickup + 2 fast-return days
      status: "PENDING",
      flagReason: null,
      flagNotes:
        "No future clean date found yet. Fast-return scheduled so linen is available for late bookings.",
      scenario: "FALLBACK",
      linenBufferSets: 1,
    });
  });

  it("no next clean + fast-return capped by maxOutdoorDays", async () => {
    findFirst.mockResolvedValue(null);
    const ops = { ...OPS, fastReturnDaysWhenNoNextClean: 9, maxOutdoorDays: 3 };
    const item = await computeDraftItem(makeJob(), ops);
    expect(item.dropoffDate).toBe(iso(day(4))); // pickup + 3 (cap wins over 9)
    expect(item.scenario).toBe("FALLBACK");
    expect(item.status).toBe("PENDING");
  });

  it("no next clean + fast-return OFF → full outdoor window", async () => {
    findFirst.mockResolvedValue(null);
    const ops = { ...OPS, fastReturnWhenNoNextClean: false, maxOutdoorDays: 4 };
    const item = await computeDraftItem(makeJob(), ops);
    expect(item.dropoffDate).toBe(iso(day(5))); // pickup + 4
    expect(item.flagNotes).toBe(
      "No future clean date found yet. Using fallback outdoor window of 4 days."
    );
    expect(item.scenario).toBe("FALLBACK");
  });

  it("never produces a NO_WINDOW flag on the normal path (every branch keeps >= 24h)", async () => {
    // The <24h guard in computeDraftItem is defensive: minDropoffDate,
    // fast-return days and the outdoor cap are all clamped to >= pickup+1.
    // Sweep the scenarios to pin that invariant.
    for (const next of [day(1), day(2), day(3), day(6), null]) {
      findFirst.mockResolvedValue(next ? { scheduledDate: next } : null);
      const item = await computeDraftItem(makeJob({}, { linenBufferSets: 0 }), OPS);
      expect(item.flagReason).not.toBe("NO_WINDOW");
      expect(new Date(item.dropoffDate).getTime() - new Date(item.pickupDate).getTime()).toBeGreaterThanOrEqual(
        24 * 60 * 60 * 1000
      );
    }
  });

  it("normal-path dates carry NO time-of-day (local midnight serialization)", async () => {
    findFirst.mockResolvedValue({ scheduledDate: day(3) });
    const item = await computeDraftItem(makeJob(), OPS);
    for (const value of [item.cleanDate, item.pickupDate, item.dropoffDate]) {
      expect(format(new Date(value), "HH:mm:ss")).toBe("00:00:00");
    }
  });
});
