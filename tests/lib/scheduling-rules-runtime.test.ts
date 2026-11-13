// @vitest-environment node
/**
 * Scheduling rules: run-time parity (dispatch score, day-of reminder window)
 * and FAIL-CLOSED reads (a corrupt or unreadable rule store stops the work; it
 * never falls back to code defaults).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  versions: vi.fn(),
  jobFindMany: vi.fn(),
  jobFindUnique: vi.fn(),
  users: vi.fn(),
  assignments: vi.fn(),
  reviews: vi.fn(),
  settingsRow: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const client: Record<string, unknown> = {
    schedulingRuleVersion: { findMany: (...args: unknown[]) => m.versions(...args), count: async () => 0, create: (...args: unknown[]) => m.create(...args) },
    job: { findMany: (...args: unknown[]) => m.jobFindMany(...args), findUnique: (...args: unknown[]) => m.jobFindUnique(...args), findFirst: async () => null },
    user: { findMany: (...args: unknown[]) => m.users(...args), findFirst: async () => null },
    jobAssignment: { findMany: (...args: unknown[]) => m.assignments(...args) },
    qAReview: { findMany: (...args: unknown[]) => m.reviews(...args) },
    appSetting: { findUnique: (...args: unknown[]) => m.settingsRow(...args) },
    notification: { findFirst: async () => null },
    $executeRaw: async () => 0,
  };
  client.$transaction = (work: (tx: unknown) => unknown) => m.transaction(work, client);
  return { db: client };
});
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/laundry/sync-draft", () => ({ replacePendingLaundrySyncDraftForProperty: vi.fn(), notifyLaundryTeamsForApprovedSyncDraft: vi.fn() }));
vi.mock("@/lib/accounts/availability", () => ({ listCleanerAvailabilities: async () => [] }));
vi.mock("@/lib/notifications/dispatch-once", () => ({ dispatchNotificationOnce: async (_identity: unknown, send: () => Promise<void>) => { await send(); return true; } }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: (...args: unknown[]) => m.send(...args) }));

import { DEFAULT_SETTINGS } from "@/lib/settings";
import { checksumOf, loadSchedulingRuleBook, originalValuesFromSettings, SchedulingRulesUnavailableError } from "@/lib/scheduling-rules/store";
import { buildLaundryPlanDraft, ensureLaundryTaskForJob } from "@/lib/laundry/planner";
import { suggestAutoAssignment } from "@/lib/ops/dispatch";
import { dispatchCleanerDayReminders } from "@/lib/ops/cleaner-day-reminders";

const ORIGINAL = originalValuesFromSettings(DEFAULT_SETTINGS).values;
const row = (patch: Record<string, unknown> = {}) => ({
  version: 1, kind: "ORIGINAL", values: ORIGINAL, effectiveFrom: "2000-01-01", appliesToExisting: false, reason: "Original",
  restoredFromVersion: null, createdById: null, createdAt: new Date("2026-01-01T00:00:00Z"), activatedAt: new Date("2026-01-01T00:00:00Z"),
  checksum: checksumOf(ORIGINAL), schemaVersion: 1, ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.transaction.mockImplementation(async (work: (tx: unknown) => unknown, client: unknown) => work(client));
  m.settingsRow.mockResolvedValue({ value: DEFAULT_SETTINGS });
});

describe("fail closed", () => {
  it("a valid version-1 row loads", async () => {
    m.versions.mockResolvedValue([row()]);
    const book = await loadSchedulingRuleBook();
    expect(book.live.version).toBe(1);
    expect(book.live.values).toEqual(ORIGINAL);
  });

  it.each([
    ["a failed checksum", [row({ checksum: "0".repeat(64) })], /checksum/],
    ["an out-of-bounds value", [row({ values: { ...ORIGINAL, "laundry.maxOutdoorDays": 99 }, checksum: checksumOf({ ...ORIGINAL, "laundry.maxOutdoorDays": 99 } as any) })], /validation/],
    ["an unknown key", [row({ values: { ...ORIGINAL, extra: 1 } })], /validation/],
    ["a different rules format", [row({ schemaVersion: 2 })], /format/],
    ["no version 1", [row({ version: 2 })], /could not be read|original/],
  ])("refuses %s", async (_label, rows, reason) => {
    m.versions.mockResolvedValue(rows);
    const error = await loadSchedulingRuleBook().catch((caught) => caught);
    expect(error).toBeInstanceOf(SchedulingRulesUnavailableError);
    expect((error as SchedulingRulesUnavailableError).reason).toMatch(reason);
  });

  it("an unreadable table is unavailable, not defaults", async () => {
    m.versions.mockRejectedValue(new Error("relation does not exist"));
    await expect(loadSchedulingRuleBook()).rejects.toBeInstanceOf(SchedulingRulesUnavailableError);
  });

  it("the first seed never falls back when the live settings cannot be read", async () => {
    m.versions.mockResolvedValue([]);
    m.settingsRow.mockRejectedValue(new Error("connection lost"));
    await expect(loadSchedulingRuleBook()).rejects.toBeInstanceOf(SchedulingRulesUnavailableError);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("the planner stops instead of planning on guessed values", async () => {
    m.versions.mockResolvedValue([row({ checksum: "bad" })]);
    await expect(buildLaundryPlanDraft(new Date("2026-11-16T00:00:00Z"))).rejects.toBeInstanceOf(SchedulingRulesUnavailableError);
    expect(m.jobFindMany).not.toHaveBeenCalled();
    m.jobFindUnique.mockResolvedValue({ id: "job", jobType: "AIRBNB_TURNOVER", isRework: false, property: { laundryEnabled: true } });
    // ensureLaundryTaskForJob reads the existing task first (none), then the rules.
    await expect(ensureLaundryTaskForJob("job", { laundryTask: { findUnique: async () => null }, job: { findUnique: m.jobFindUnique }, schedulingRuleVersion: { findMany: m.versions } } as any)).rejects.toBeInstanceOf(SchedulingRulesUnavailableError);
  });
});

describe("dispatch suggestion score (original weights and constants)", () => {
  it("scores exactly as before: 40/35/25 weights, QA 70 when unknown, +12 when available", async () => {
    m.jobFindUnique.mockResolvedValue({ id: "job", jobType: "AIRBNB_TURNOVER", propertyId: "p", scheduledDate: new Date("2026-11-20T00:00:00Z"), property: { suburb: "Bondi", name: "House" } });
    m.users.mockResolvedValue([{ id: "a", name: "Alex", email: "a@x" }, { id: "b", name: "Blair", email: "b@x" }]);
    m.assignments.mockResolvedValue([{ userId: "a", jobId: "other" }]);
    m.jobFindMany.mockResolvedValue([{ assignments: [{ userId: "a" }] }, { assignments: [{ userId: "a" }] }]);
    m.reviews.mockResolvedValue([{ score: 90, job: { assignments: [{ userId: "a" }] } }]);
    vi.spyOn(await import("@/lib/settings"), "getAppSettings").mockResolvedValue(DEFAULT_SETTINGS);
    const scored = await suggestAutoAssignment("job");
    expect(scored.map((item) => [item.cleanerId, item.score])).toEqual([["a", 102.25], ["b", 61.5]]);
  });
});

describe("day-of reminder window (original 6 AM / 2 hours)", () => {
  const job = { id: "job", jobNumber: "J1", jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-10-02T14:00:00Z"), startTime: "10:00", dueTime: null, endTime: null, internalNotes: null, property: { name: "House", address: "1 St" }, assignments: [{ user: { id: "c", role: "CLEANER", name: "C", email: null, phone: null } }] };
  beforeEach(() => {
    m.jobFindMany.mockResolvedValue([job]);
    m.send.mockResolvedValue(undefined);
  });
  async function sends(now: string, rules?: { dayReminderUnlockHour: number; dayReminderLeadHours: number }) {
    m.send.mockClear();
    await dispatchCleanerDayReminders(new Date(now), rules);
    return m.send.mock.calls.length;
  }
  it("unlocks at 06:00 Sydney with or without the explicit original rules", async () => {
    // 3 Oct 2026 is AEST (+10): 06:00 Sydney = 20:00Z on 2 Oct; the 10:00 start is 00:00Z.
    for (const rules of [undefined, { dayReminderUnlockHour: 6, dayReminderLeadHours: 2 }]) {
      expect(await sends("2026-10-02T19:59:00Z", rules)).toBe(0);
      expect(await sends("2026-10-02T20:00:00Z", rules)).toBe(1);
    }
  });
  it("a published later unlock hour takes effect at run time", async () => {
    expect(await sends("2026-10-02T20:00:00Z", { dayReminderUnlockHour: 7, dayReminderLeadHours: 2 })).toBe(0);
    expect(await sends("2026-10-02T21:00:00Z", { dayReminderUnlockHour: 7, dayReminderLeadHours: 2 })).toBe(1);
  });
});
