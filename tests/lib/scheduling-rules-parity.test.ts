// @vitest-environment node
/**
 * ZERO BEHAVIOUR CHANGE (owner decision 2026-11-14: "do not change any rules at
 * all as they are exactly as I need").
 *
 * The scheduling literals moved into lib/scheduling-rules/constants.ts and the
 * engine now reads published rule versions. These tests pin, with the literal
 * numbers and sentences read from the code BEFORE the change, that with the
 * original version (no edit published) every rule produces exactly what it did.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  versions: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    job: { findFirst: (...args: unknown[]) => m.findFirst(...args), findMany: (...args: unknown[]) => m.findMany(...args) },
    schedulingRuleVersion: { findMany: (...args: unknown[]) => m.versions(...args) },
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/laundry/sync-draft", () => ({ replacePendingLaundrySyncDraftForProperty: vi.fn(), notifyLaundryTeamsForApprovedSyncDraft: vi.fn() }));

import * as C from "@/lib/scheduling-rules/constants";
import {
  EDITABLE_RULE_KEYS,
  EDITABLE_RULE_SPECS,
  ORIGINAL_CODE_VALUES,
  ORIGINAL_LAUNDRY_PLANNING,
  ORIGINAL_RUN_TIME_RULES,
  SETTINGS_FIELD_DEFAULTS,
  laundryOperationsFrom,
  laundryPlanningFrom,
  readSettingPath,
  validateRuleValues,
  type SchedulingRuleValues,
} from "@/lib/scheduling-rules/values";
import { RULES, RULE_BY_EDITABLE_KEY, ruleSentence } from "@/lib/scheduling-rules/registry";
import { buildRuleBook, type RuleVersionRecord } from "@/lib/scheduling-rules/book";
import { checksumOf, originalValuesFromSettings } from "@/lib/scheduling-rules/store";
import { DEFAULT_SETTINGS, keepSchedulingRuleFields, schedulingRuleFieldsChanged } from "@/lib/settings";
import { buildLaundrySyncDraft, computeDraftItem, laundryResolverFromBook } from "@/lib/laundry/planner";
import { computeKeyLostDraftItem } from "@/lib/laundry/key-lost";
import { resolveCleanStart, resolveKeyLostServiceTime } from "@/lib/laundry/clean-start";
import { selectStaleDriverTasks } from "@/lib/laundry/reminders";
import { airbnbReadinessDeadline, airbnbReadinessDeadlineBy } from "@/lib/jobs/turnover-readiness";
import { resolveAirbnbTurnoverTimes } from "@/lib/ical/times";
import { classifySameDayCheckinPriority } from "@/lib/jobs/priority";
import { qualifiesForAutoPause } from "@/lib/ops/auto-pause";
import { planRecurringOccurrences, type RecurringJobRule } from "@/lib/ops/recurring";
import { resolveClockRuleForLog } from "@/lib/time/clock-rules";
import { ROUTE_ARRIVAL_RADIUS_M, NAIVE_PER_STOP_MIN, NAIVE_SPEED_KMH } from "@/lib/laundry/route-plan";
import { ROUTE_OVERDUE_CAP } from "@/lib/laundry/route-candidates";
import { NUDGE_COOL_DOWN_MINUTES } from "@/lib/laundry/nudge-rules";
import { SUPPLIER_CHASE_COOL_DOWN_MINUTES } from "@/lib/laundry/supplier-chase-rules";
import { MAX_BACKDATE_MS, MISSED_CLOCK_IN_GRACE_MS } from "@/lib/jobs/missed-clock-in";
import { DEPARTURE_CONFIRM_PINGS, DEPARTURE_MAX_ACCURACY_M, DEPARTURE_MIN_SPAN_MS } from "@/lib/gps/departure";

/** Version 1 exactly as the seed builds it from the default settings. */
const ORIGINAL: SchedulingRuleValues = originalValuesFromSettings(DEFAULT_SETTINGS).values;

function versionRecord(values: SchedulingRuleValues, patch: Partial<RuleVersionRecord> = {}): RuleVersionRecord {
  return {
    version: 1, kind: "ORIGINAL", values, effectiveFrom: "2000-01-01", appliesToExisting: false, reason: "Original",
    restoredFromVersion: null, createdById: null, createdAt: new Date("2026-01-01T00:00:00Z"), activatedAt: new Date("2026-01-01T00:00:00Z"),
    checksum: checksumOf(values), schemaVersion: 1, ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the original literals are unchanged", () => {
  it("every moved constant still holds the value the code had", () => {
    expect([C.LAUNDRY_PICKUP_OFFSET_DAYS, C.LAUNDRY_MIN_TURNAROUND_DAYS, C.LAUNDRY_BACK_TO_BACK_MAX_GAP_DAYS, C.LAUNDRY_MICRO_CYCLE_MAX_GAP_DAYS, C.LAUNDRY_BUFFER_FLAG_AT_OR_BELOW_SETS, C.LAUNDRY_DROP_DAYS_BEFORE_NEXT_CLEAN]).toEqual([1, 1, 1, 3, 0, 1]);
    expect([C.LAUNDRY_DEFAULT_CLEAN_START, C.LAUNDRY_KEY_LOST_LATE_CHECKOUT_TIME]).toEqual(["10:00", "12:30"]);
    expect([C.LAUNDRY_PICKED_UP_STALE_HOURS, C.LAUNDRY_ADMIN_ATTENTION_STALE_HOURS, C.LAUNDRY_NUDGE_COOL_DOWN_MINUTES]).toEqual([24, 48, 30]);
    expect([C.LAUNDRY_CLEANER_FALLBACK_PICKUP_HOURS, C.LAUNDRY_CLEANER_FALLBACK_DROPOFF_HOURS]).toEqual([24, 48]);
    expect([C.LAUNDRY_ROUTE_OVERDUE_CAP, C.LAUNDRY_ROUTE_ARRIVAL_RADIUS_M, C.LAUNDRY_ROUTE_NAIVE_SPEED_KMH, C.LAUNDRY_ROUTE_NAIVE_PER_STOP_MIN]).toEqual([20, 120, 35, 7]);
    expect([C.TURNOVER_READY_BY_TIME, C.PRIORITY_EARLY_CHECKIN_TIME, C.PRIORITY_SAME_DAY_CHECKIN_TIME]).toEqual(["15:00", "12:30", "15:00"]);
    expect([C.ICAL_FEED_TIMEOUT_MS, C.ICAL_SYNC_CONCURRENCY, C.ICAL_INTERRUPTED_RUN_AFTER_MS, C.ICAL_LEGACY_DUE_INTERVAL_MS]).toEqual([15_000, 4, 20 * 60_000, 40 * 60_000]);
    expect([...C.ICAL_TERMINAL_JOB_STATUSES]).toEqual(["COMPLETED", "INVOICED", "CANCELLED"]);
    expect([...C.ICAL_PRUNABLE_JOB_STATUSES]).toEqual(["UNASSIGNED", "OFFERED", "ASSIGNED"]);
    expect([C.AUTO_PAUSE_AFTER_HOURS, C.AUTO_PAUSE_MAX_JOBS_PER_RUN, C.STALE_EN_ROUTE_HOURS, C.DAY_REMINDER_UNLOCK_HOUR, C.DAY_REMINDER_LEAD_HOURS]).toEqual([24, 50, 6, 6, 2]);
    expect([C.REMINDER_DEFAULT_JOB_TIME, C.UNFINISHED_PUSH_DEDUP_HOURS, C.CLIENT_TASK_AUTO_APPROVE_LEAD_MINUTES, C.MISSED_CLOCK_IN_GRACE_MINUTES, C.MISSED_CLOCK_IN_MAX_BACKDATE_HOURS]).toEqual(["09:00", 20, 60, 12, 10]);
    expect(C.DEEP_CLEAN_CADENCE_MONTHS).toBe(3);
    expect([C.DISPATCH_DEFAULT_QA_SCORE, C.DISPATCH_AVAILABLE_BONUS, C.DISPATCH_UNAVAILABLE_PENALTY, C.DISPATCH_SAME_SUBURB_TRAVEL_MIN, C.DISPATCH_OTHER_SUBURB_TRAVEL_MIN]).toEqual([70, 12, -25, 8, 22]);
  });

  it("modules that re-export a moved value still export the original", () => {
    expect([ROUTE_ARRIVAL_RADIUS_M, NAIVE_SPEED_KMH, NAIVE_PER_STOP_MIN, ROUTE_OVERDUE_CAP]).toEqual([120, 35, 7, 20]);
    expect([NUDGE_COOL_DOWN_MINUTES, SUPPLIER_CHASE_COOL_DOWN_MINUTES]).toEqual([30, 30]);
    expect([MISSED_CLOCK_IN_GRACE_MS, MAX_BACKDATE_MS]).toEqual([12 * 60 * 1000, 10 * 60 * 60 * 1000]);
    // lib/gps/departure.ts keeps its own literals; the screen shows the copies in constants.ts.
    expect([DEPARTURE_CONFIRM_PINGS, DEPARTURE_MIN_SPAN_MS, DEPARTURE_MAX_ACCURACY_M]).toEqual([C.DEPARTURE_CONFIRM_PINGS_VALUE, C.DEPARTURE_MIN_SPAN_MINUTES * 60_000, C.DEPARTURE_MAX_ACCURACY_M_VALUE]);
  });

  it("version-1 code values are the literals; the planner's original rules match", () => {
    expect(ORIGINAL_CODE_VALUES).toEqual({
      "laundry.pickupOffsetDays": 1, "laundry.minTurnaroundDays": 1, "laundry.backToBackMaxGapDays": 1, "laundry.microCycleMaxGapDays": 3,
      "laundry.bufferFlagAtOrBelowSets": 0, "laundry.keyLostServiceTime": "10:00", "laundry.keyLostLateCheckoutTime": "12:30",
      "laundry.defaultCleanStartTime": "10:00", "laundry.pickedUpStaleHours": 24, "jobs.turnoverReadyByTime": "15:00",
      "jobs.autoPauseAfterHours": 24, "jobs.staleEnRouteHours": 6, "jobs.dayReminderUnlockHour": 6, "jobs.dayReminderLeadHours": 2,
    });
    expect(laundryPlanningFrom(ORIGINAL)).toEqual(ORIGINAL_LAUNDRY_PLANNING);
    expect(ORIGINAL_RUN_TIME_RULES).toEqual({ autoPauseAfterHours: 24, staleEnRouteHours: 6, dayReminderUnlockHour: 6, dayReminderLeadHours: 2, laundryPickedUpStaleHours: 24 });
  });

  it("the absent-field defaults are exactly lib/settings DEFAULT_SETTINGS", () => {
    for (const [key, value] of Object.entries(SETTINGS_FIELD_DEFAULTS)) {
      const spec = EDITABLE_RULE_SPECS[key as keyof typeof EDITABLE_RULE_SPECS];
      expect(spec.storage.kind, key).toBe("setting");
      expect(readSettingPath(DEFAULT_SETTINGS, (spec.storage as { path: [string, string] }).path), key).toBe(value);
    }
  });

  it("version 1 seeded from settings takes the LIVE stored values, never code defaults", () => {
    const live = { ...DEFAULT_SETTINGS, laundryOperations: { ...DEFAULT_SETTINGS.laundryOperations, maxOutdoorDays: 6, fastReturnWhenNoNextClean: false }, recurringJobs: { enabled: false, lookaheadDays: 21 } };
    const seeded = originalValuesFromSettings(live);
    expect(seeded.missing).toEqual([]);
    expect(seeded.values["laundry.maxOutdoorDays"]).toBe(6);
    expect(seeded.values["laundry.fastReturnWhenNoNextClean"]).toBe(false);
    expect(seeded.values["jobs.recurringLookaheadDays"]).toBe(21);
    expect(seeded.values["jobs.recurringEnabled"]).toBe(false);
    expect(validateRuleValues(seeded.values).ok).toBe(true);
    expect(validateRuleValues(ORIGINAL).ok).toBe(true);
  });
});

describe("the registry describes every editable rule once", () => {
  it("covers each editable key exactly once and renders every sentence", () => {
    const keys = RULES.flatMap((rule) => (rule.editableKey ? [rule.editableKey] : []));
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...EDITABLE_RULE_KEYS].sort());
    for (const rule of RULES) expect(ruleSentence(rule, ORIGINAL).length, rule.id).toBeGreaterThan(10);
    expect(RULE_BY_EDITABLE_KEY["laundry.maxOutdoorDays"]?.quirk).toMatch(/both/);
    expect(RULES.find((rule) => rule.id === "laundry.weekends")?.kind).toBe("not-applied");
    expect(RULES.find((rule) => rule.id === "jobs.mid-stay")?.kind).toBe("not-applied");
    expect(RULES.filter((rule) => rule.kind === "unused").map((rule) => rule.editableKey)).toEqual(["laundry.pickupCutoffTime", "laundry.defaultPickupTime", "laundry.defaultDropoffTime", "jobs.routeEnabled"]);
    expect(RULES.find((rule) => rule.id === "laundry.drop-before-next")?.quirk).toMatch(/CANCELLED/);
    expect(RULES.find((rule) => rule.id === "jobs.ical-conflict")?.quirk).toMatch(/CANCELLED/);
    expect(RULES.find((rule) => rule.id === "jobs.recurring")?.quirk).toMatch(/UTC/);
    expect(RULES.find((rule) => rule.id === "laundry.timezone")?.quirk).toMatch(/time zone/);
  });
});

// ── Laundry planner golden fixtures ──────────────────────────────────────────

/** Local-midnight day (the planner normalizes with date-fns startOfDay). */
const day = (offset = 0) => new Date(2026, 7, 10 + offset);
const iso = (date: Date) => date.toISOString();
const at = (h: number, mm: number) => new Date(2026, 7, 10, h, mm, 0, 0).toISOString();

function plannerJob(patch: { linenBufferSets?: number; keyLostMode?: boolean; internalNotes?: string | null } = {}) {
  return {
    id: "job-1", propertyId: "prop-1", scheduledDate: day(0), internalNotes: patch.internalNotes ?? null, startTime: null,
    property: { name: "Harbour View", suburb: "Bondi", linenBufferSets: patch.linenBufferSets ?? 0, keyLostMode: patch.keyLostMode ?? false, defaultCheckoutTime: "10:00" },
  } as any;
}

const OPS = laundryOperationsFrom(ORIGINAL);

const GOLDEN: Array<{ name: string; next: Date | null; job: ReturnType<typeof plannerJob>; ops?: typeof OPS; expected: Record<string, unknown> }> = [
  { name: "back-to-back, no buffer linen", next: day(1), job: plannerJob(), expected: { pickupDate: iso(day(1)), dropoffDate: iso(day(2)), status: "FLAGGED", flagReason: "EXPRESS_OR_EXTRA_LINEN_REQUIRED", flagNotes: "Back-to-back clean dates with no buffer linen set configured.", scenario: "BACK_TO_BACK" } },
  { name: "back-to-back, one buffer set", next: day(1), job: plannerJob({ linenBufferSets: 1 }), expected: { pickupDate: iso(day(1)), dropoffDate: iso(day(2)), status: "PENDING", flagReason: null, flagNotes: "Tight gap detected; returning on the earliest valid date after 24h.", scenario: "BACK_TO_BACK" } },
  { name: "micro-cycle (gap 3)", next: day(3), job: plannerJob(), expected: { pickupDate: iso(day(1)), dropoffDate: iso(day(2)), status: "PENDING", flagReason: null, flagNotes: "Return scheduled for the day before the next known clean.", scenario: "MICRO_CYCLE" } },
  { name: "micro-cycle (gap 2)", next: day(2), job: plannerJob(), expected: { pickupDate: iso(day(1)), dropoffDate: iso(day(2)), status: "PENDING", flagReason: null, flagNotes: "Tight gap detected; returning on the earliest valid date after 24h.", scenario: "MICRO_CYCLE" } },
  { name: "compressed (gap 6)", next: day(6), job: plannerJob(), expected: { pickupDate: iso(day(1)), dropoffDate: iso(day(5)), status: "PENDING", flagReason: null, flagNotes: "Return scheduled for the day before the next known clean.", scenario: "COMPRESSED" } },
  { name: "fallback, fast return 1 day", next: null, job: plannerJob(), expected: { pickupDate: iso(day(1)), dropoffDate: iso(day(2)), status: "PENDING", flagReason: null, flagNotes: "No future clean date found yet. Fast-return scheduled so linen is available for late bookings.", scenario: "FALLBACK" } },
  { name: "fallback, fast return 5 days capped at 3", next: null, job: plannerJob(), ops: { ...OPS, fastReturnDaysWhenNoNextClean: 5 }, expected: { pickupDate: iso(day(1)), dropoffDate: iso(day(4)), status: "PENDING", flagReason: null, scenario: "FALLBACK" } },
  { name: "fallback, no fast return (3-day window)", next: null, job: plannerJob(), ops: { ...OPS, fastReturnWhenNoNextClean: false }, expected: { pickupDate: iso(day(1)), dropoffDate: iso(day(4)), status: "PENDING", flagReason: null, flagNotes: "No future clean date found yet. Using fallback outdoor window of 3 days.", scenario: "FALLBACK" } },
  { name: "fallback, no fast return, 1-day window", next: null, job: plannerJob(), ops: { ...OPS, fastReturnWhenNoNextClean: false, maxOutdoorDays: 1 }, expected: { dropoffDate: iso(day(2)), flagNotes: "No future clean date found yet. Using fallback outdoor window of 1 day." } },
  { name: "key lost, no late checkout", next: day(1), job: plannerJob({ keyLostMode: true }), expected: { pickupDate: at(10, 0), dropoffDate: at(10, 0), status: "PENDING", flagReason: null, flagNotes: "KEY_LOST: spare key unavailable — pickup and drop-off both on the clean day at 10:00, after the clean starts.", scenario: "KEY_LOST" } },
  { name: "key lost, late checkout", next: null, job: plannerJob({ keyLostMode: true, internalNotes: JSON.stringify({ version: 1, lateCheckout: { enabled: true, preset: "12:30" } }) }), expected: { pickupDate: at(12, 30), dropoffDate: at(12, 30), flagNotes: "KEY_LOST: spare key unavailable — pickup and drop-off both on the clean day at 12:30 (late checkout), after the clean starts.", scenario: "KEY_LOST" } },
];

describe("laundry planner golden fixtures (original rules)", () => {
  it.each(GOLDEN)("$name", async ({ next, job, ops, expected }) => {
    m.findFirst.mockResolvedValue(next ? { scheduledDate: next } : null);
    const operations = ops ?? OPS;
    const implicit = await computeDraftItem(job, operations);
    const explicit = await computeDraftItem(job, operations, undefined, laundryPlanningFrom(ORIGINAL));
    expect(implicit).toMatchObject(expected);
    expect(explicit).toEqual(implicit);
    expect(implicit.cleanDate).toBe(iso(day(0)));
  });

  it("the next-clean lookup is unchanged: not a rework, not invoiced (cancelled jobs still count)", async () => {
    m.findFirst.mockResolvedValue(null);
    await computeDraftItem(plannerJob(), OPS);
    expect(m.findFirst).toHaveBeenCalledWith({
      where: { propertyId: "prop-1", jobType: "AIRBNB_TURNOVER", isRework: false, id: { not: "job-1" }, scheduledDate: { gt: day(0) }, status: { not: "INVOICED" } },
      select: { scheduledDate: true },
      orderBy: { scheduledDate: "asc" },
    });
  });

  it("key-lost helpers keep their original times", () => {
    expect(resolveKeyLostServiceTime({ internalNotes: null })).toBe("10:00");
    expect(computeKeyLostDraftItem(plannerJob({ keyLostMode: true })).pickupDate).toBe(at(10, 0));
    expect(resolveCleanStart({ internalNotes: null, startTime: null }, { defaultCheckoutTime: null })).toBe("10:00");
    expect(resolveCleanStart({ internalNotes: null, startTime: null }, { defaultCheckoutTime: null }, ORIGINAL["laundry.defaultCleanStartTime"])).toBe("10:00");
  });
});

describe("re-planning unchanged data proposes nothing", () => {
  function syncJob(task: Record<string, unknown> | null) {
    return { ...plannerJob({ linenBufferSets: 1 }), laundryTask: task };
  }

  it("buildLaundrySyncDraft yields zero UPDATE items when stored runs match the original rules", async () => {
    m.findFirst.mockResolvedValue({ scheduledDate: day(6) });
    const planned = await computeDraftItem(plannerJob({ linenBufferSets: 1 }), OPS);
    const stored = { id: "task-1", createdAt: new Date("2026-08-01T00:00:00Z"), status: planned.status, pickupDate: new Date(planned.pickupDate), dropoffDate: new Date(planned.dropoffDate), flagReason: planned.flagReason, flagNotes: planned.flagNotes, pickedUpAt: null, droppedAt: null, confirmations: [] };
    m.findMany.mockResolvedValue([syncJob(stored)]);
    const book = buildRuleBook([versionRecord(ORIGINAL)]);
    expect(await buildLaundrySyncDraft({ propertyId: "prop-1" }, laundryResolverFromBook(book))).toEqual([]);
    // Same through the real store read (version 1 row with a valid checksum).
    m.versions.mockResolvedValue([{ ...versionRecord(ORIGINAL), values: ORIGINAL }]);
    expect(await buildLaundrySyncDraft({ propertyId: "prop-1" })).toEqual([]);
  });

  it("an existing run keeps its own version after a later edit unless re-plan was chosen", async () => {
    m.findFirst.mockResolvedValue({ scheduledDate: day(6) });
    const planned = await computeDraftItem(plannerJob({ linenBufferSets: 1 }), OPS);
    const stored = { id: "task-1", createdAt: new Date("2026-08-01T00:00:00Z"), status: planned.status, pickupDate: new Date(planned.pickupDate), dropoffDate: new Date(planned.dropoffDate), flagReason: planned.flagReason, flagNotes: planned.flagNotes, pickedUpAt: null, droppedAt: null, confirmations: [] };
    m.findMany.mockResolvedValue([syncJob(stored)]);
    const edited = { ...ORIGINAL, "laundry.pickupOffsetDays": 2 };
    const now = new Date("2026-09-10T00:00:00Z");
    const later = versionRecord(edited, { version: 2, kind: "EDIT", effectiveFrom: "2026-09-01" });
    expect(await buildLaundrySyncDraft({ propertyId: "prop-1" }, laundryResolverFromBook(buildRuleBook([versionRecord(ORIGINAL), later], now)))).toEqual([]);
    const replan = await buildLaundrySyncDraft({ propertyId: "prop-1" }, laundryResolverFromBook(buildRuleBook([versionRecord(ORIGINAL), { ...later, appliesToExisting: true }], now)));
    expect(replan).toHaveLength(1);
    expect(replan[0]).toMatchObject({ operation: "UPDATE", pickupDate: iso(day(2)) });
  });
});

describe("job times and priority (original rules)", () => {
  const none = { enabled: false, preset: "none" } as const;
  const early1130 = { enabled: true, preset: "11:00" } as const;
  const late1230 = { enabled: true, preset: "12:30" } as const;

  it.each([
    ["10:00", "14:00", none, none, { startTime: "10:00", dueTime: "14:00" }],
    ["10:00", "16:00", none, none, { startTime: "10:00", dueTime: "15:00" }],
    ["10:00", null, none, none, { startTime: "10:00", dueTime: "15:00" }],
    ["10:00", "16:00", early1130, none, { startTime: "10:00", dueTime: "11:00" }],
    ["10:00", "14:00", none, late1230, { startTime: "12:30", dueTime: "14:00" }],
  ])("checkout %s, check-in %s", (start, due, earlyCheckin, lateCheckout, expected) => {
    const input = { reservationStartTime: start, reservationDueTime: due, earlyCheckin, lateCheckout } as any;
    expect(resolveAirbnbTurnoverTimes(input)).toEqual(expected);
    expect(resolveAirbnbTurnoverTimes(input, ORIGINAL["jobs.turnoverReadyByTime"])).toEqual(expected);
  });

  it("the ready-by deadline is 15:00 and the explicit form agrees", () => {
    for (const times of [[], ["14:00"], ["16:00"], ["11:00", "14:00"], ["bad"]] as string[][]) {
      expect(airbnbReadinessDeadlineBy("15:00", ...times)).toBe(airbnbReadinessDeadline(...times));
    }
    expect(airbnbReadinessDeadline()).toBe("15:00");
  });

  it.each([
    [true, "10:00", 1], [true, "12:30", 1], [true, "12:31", 2], [true, "15:00", 2], [true, "15:01", 3], [true, null, 4], [false, "10:00", 4],
  ])("same-day %s at %s is priority %i", (sameDayCheckin, sameDayCheckinTime, bucket) => {
    expect(classifySameDayCheckinPriority({ sameDayCheckin: sameDayCheckin as boolean, sameDayCheckinTime: sameDayCheckinTime as string | null }).priorityBucket).toBe(bucket);
  });
});

describe("recurring dry run is the generator's own decision", () => {
  const rule: RecurringJobRule = { id: "r1", name: "Weekly", isActive: true, propertyId: "p1", jobType: "GENERAL_CLEAN" as any, daysOfWeek: [1, 3], startTime: "09:00", assigneeIds: [] };
  it("plans Mondays and Wednesdays in UTC, skipping existing and inactive", () => {
    const start = new Date("2026-11-16T00:00:00Z");
    const end = new Date("2026-11-25T00:00:00Z");
    const existing = [{ propertyId: "p1", jobType: "GENERAL_CLEAN", scheduledDate: new Date("2026-11-18T00:00:00Z"), startTime: "09:00", internalNotes: null }];
    const plan = planRecurringOccurrences({ rules: [rule, { ...rule, id: "r2", propertyId: "inactive" }], activePropertyIds: new Set(["p1"]), existingJobs: existing, start, end });
    expect(plan.occurrences.map((item) => item.key)).toEqual(["2026-11-16", "2026-11-23", "2026-11-25"]);
    expect(plan.skipped).toBe(2);
  });
});

describe("clocks, sweeps and reminders (original rules)", () => {
  it("auto-pause qualifies after more than 24 hours, the same with the explicit rule", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    for (const hoursAgo of [23, 24, 24.01, 30]) {
      const input = { status: "IN_PROGRESS", openLogStartedAt: new Date(now.getTime() - hoursAgo * 3_600_000), latestLogStartedAt: null, now };
      expect(qualifiesForAutoPause({ ...input, afterHours: ORIGINAL["jobs.autoPauseAfterHours"] })).toBe(qualifiesForAutoPause(input));
    }
    expect(qualifiesForAutoPause({ status: "IN_PROGRESS", openLogStartedAt: new Date(now.getTime() - 24.01 * 3_600_000), latestLogStartedAt: null, now })).toBe(true);
  });

  it("driver nudge: picked up more than 24 hours, the same with the explicit rule", () => {
    const now = new Date("2026-10-03T05:00:00Z");
    const tasks = [23, 25].map((hours, index) => ({ id: `t${index}`, status: "PICKED_UP", pickupDate: "2026-09-01", dropoffDate: "2026-09-05", pickedUpAt: new Date(now.getTime() - hours * 3_600_000), updatedAt: now }));
    expect(selectStaleDriverTasks(tasks, now).map((task) => task.id)).toEqual(["t1"]);
    expect(selectStaleDriverTasks(tasks, now, ORIGINAL["laundry.pickedUpStaleHours"] * 3_600_000)).toEqual(selectStaleDriverTasks(tasks, now));
  });

  it("clock cutoffs follow the original settings", () => {
    const startedAt = new Date("2026-10-02T23:00:00Z");
    const job = { scheduledDate: new Date("2026-10-03T00:00:00Z"), dueTime: "14:00", endTime: null, estimatedHours: 3 };
    const result = resolveClockRuleForLog({ job, startedAt, settings: DEFAULT_SETTINGS });
    expect(result.source).toBe("MAX_JOB_LENGTH");
    expect(result.allowedDurationMinutes).toBe(8 * 60);
    const noDue = resolveClockRuleForLog({ job: { ...job, dueTime: null }, startedAt, settings: DEFAULT_SETTINGS });
    expect(noDue.source).toBe("MAX_JOB_LENGTH");
  });
});

describe("scheduling-rule settings are owned by the rule service", () => {
  it("a generic save keeps every rule-owned field and reports the attempted change", () => {
    const stored = DEFAULT_SETTINGS;
    const requested = { ...DEFAULT_SETTINGS, laundryOperations: { ...DEFAULT_SETTINGS.laundryOperations, maxOutdoorDays: 9 }, qaAutomation: { ...DEFAULT_SETTINGS.qaAutomation, assignedOnly: false, reworkDelayHours: 48 } };
    const kept = keepSchedulingRuleFields(requested, stored);
    expect(kept.laundryOperations.maxOutdoorDays).toBe(3);
    expect(kept.qaAutomation.reworkDelayHours).toBe(24);
    expect(kept.qaAutomation.assignedOnly).toBe(false); // not a scheduling rule: saved as asked
    expect(schedulingRuleFieldsChanged({ laundryOperations: requested.laundryOperations, qaAutomation: requested.qaAutomation }, stored)).toEqual(["laundryOperations.maxOutdoorDays", "qaAutomation.reworkDelayHours"]);
  });
});

describe("the rule book", () => {
  const now = new Date("2026-11-20T05:00:00Z");
  it("live is the highest effective version; scheduled ones wait; items keep their version", () => {
    const v2 = versionRecord({ ...ORIGINAL, "laundry.pickupOffsetDays": 2 }, { version: 2, kind: "EDIT", effectiveFrom: "2026-11-10" });
    const v3 = versionRecord({ ...ORIGINAL, "laundry.pickupOffsetDays": 3 }, { version: 3, kind: "EDIT", effectiveFrom: "2026-12-01" });
    const book = buildRuleBook([v3, versionRecord(ORIGINAL), v2], now);
    expect(book.live.version).toBe(2);
    expect(book.scheduled.map((record) => record.version)).toEqual([3]);
    expect(book.forItem(new Date("2026-11-01T00:00:00Z")).version).toBe(1);
    expect(book.forItem(new Date("2026-11-15T00:00:00Z")).version).toBe(2);
    expect(book.forItem(null).version).toBe(2);
  });
  it("refuses a book with no original version", () => {
    expect(() => buildRuleBook([], now)).toThrow();
  });
});
