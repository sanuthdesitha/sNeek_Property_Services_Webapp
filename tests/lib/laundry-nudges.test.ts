// @vitest-environment node
/**
 * Laundry on-demand nudges: which runs offer "Ask cleaner" / "Request photo"
 * (lib/laundry/nudge-rules.ts, from the Pipeline's exception rules) and the
 * server cool-down per run and kind on the existing nudge route.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ task: vi.fn(), audit: vi.fn(), recent: vi.fn(), office: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { laundryTask: { findUnique: m.task }, auditLog: { create: m.audit, findFirst: m.recent }, appSetting: { findUnique: vi.fn() } } }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.office }));
vi.mock("@/lib/notifications/type-controls", () => ({ getNotificationTypeControls: async () => ({ respectsPreferences: {}, disabledTransports: {} }), typeRespectsPreferences: () => false }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));

import { laundryNudgeKinds, laundryTeamRequestKinds, nudgeIdempotencyKey, teamRequestBlockedReason, NUDGE_COOL_DOWN_MINUTES } from "@/lib/laundry/nudge-rules";
import { sendLaundryCleanerNudge } from "@/lib/notifications/office-actions";
import type { PipelineException } from "@/lib/laundry/pipeline";

const TODAY = "2026-11-11";
const exc = (code: PipelineException["code"]): PipelineException => ({ code, label: code });
const run = (overrides: Partial<Parameters<typeof laundryNudgeKinds>[0]> = {}) => ({
  status: "PENDING", pickupDate: "2026-11-11T00:00:00.000Z", exceptions: [] as PipelineException[], readiness: true as boolean | null, jobStatus: "SUBMITTED", hasJob: true, ...overrides,
});

describe("which nudges a run offers (owner decision 2026-11-12: cleaners only for the bags)", () => {
  it("offers Ask cleaner only when the bags at the property are in doubt", () => {
    expect(laundryNudgeKinds(run({ readiness: false, exceptions: [exc("NOT_READY")] }), TODAY)).toEqual(["ASK_CLEANER"]);
    // Bags not confirmed on the pickup day, clean finished.
    expect(laundryNudgeKinds(run({ readiness: null }), TODAY)).toEqual(["ASK_CLEANER"]);
    // An overdue pickup the cleaner already marked ready is the laundry team's, not the cleaner's.
    expect(laundryNudgeKinds(run({ exceptions: [exc("PICKUP_OVERDUE")] }), TODAY)).toEqual([]);
    // Nothing in doubt: ready, or the clean is still in progress, or pickup is in the future.
    expect(laundryNudgeKinds(run(), TODAY)).toEqual([]);
    expect(laundryNudgeKinds(run({ readiness: null, jobStatus: "IN_PROGRESS" }), TODAY)).toEqual([]);
    expect(laundryNudgeKinds(run({ readiness: null, pickupDate: "2026-11-13T00:00:00.000Z" }), TODAY)).toEqual([]);
    // Already picked up or delivered: the cleaner has nothing to confirm (no more cleaner photo requests).
    expect(laundryNudgeKinds(run({ status: "PICKED_UP", exceptions: [exc("DROP_OVERDUE")] }), TODAY)).toEqual([]);
    expect(laundryNudgeKinds(run({ status: "DROPPED", exceptions: [exc("NO_DROP_PHOTO")] }), TODAY)).toEqual([]);
  });

  it("offers nothing to a cleaner for a run without a linked job", () => {
    expect(laundryNudgeKinds(run({ hasJob: false, readiness: false, exceptions: [exc("NOT_READY")] }), TODAY)).toEqual([]);
  });
});

describe("which laundry team requests a run offers", () => {
  const teamRun = (overrides: Partial<Parameters<typeof laundryTeamRequestKinds>[0]> = {}) => ({ ...run(), dropoffDate: "2026-11-12T00:00:00.000Z", hasSupplier: true, ...overrides });

  it("asks the team to confirm a due or overdue pickup unless the bags are not ready", () => {
    expect(laundryTeamRequestKinds(teamRun(), TODAY)).toEqual(["TEAM_CONFIRM_PICKUP"]);
    expect(laundryTeamRequestKinds(teamRun({ readiness: null, exceptions: [exc("PICKUP_OVERDUE")] }), TODAY)).toEqual(["TEAM_CONFIRM_PICKUP"]);
    expect(laundryTeamRequestKinds(teamRun({ readiness: false, exceptions: [exc("NOT_READY"), exc("PICKUP_OVERDUE")] }), TODAY)).toEqual([]);
    expect(laundryTeamRequestKinds(teamRun({ pickupDate: "2026-11-13T00:00:00.000Z" }), TODAY)).toEqual([]);
  });

  it("asks when it will be back, confirms a due drop-off, and asks for the missing drop photo", () => {
    expect(laundryTeamRequestKinds(teamRun({ status: "PICKED_UP", dropoffDate: "2026-11-13T00:00:00.000Z", exceptions: [exc("OVER_TURNAROUND")] }), TODAY)).toEqual(["TEAM_RETURN_ETA"]);
    expect(laundryTeamRequestKinds(teamRun({ status: "PICKED_UP", dropoffDate: TODAY }), TODAY)).toEqual(["TEAM_CONFIRM_DROP"]);
    expect(laundryTeamRequestKinds(teamRun({ status: "PICKED_UP", dropoffDate: "2026-11-09T00:00:00.000Z", exceptions: [exc("DROP_OVERDUE")] }), TODAY)).toEqual(["TEAM_RETURN_ETA", "TEAM_CONFIRM_DROP"]);
    expect(laundryTeamRequestKinds(teamRun({ status: "DROPPED", exceptions: [exc("NO_DROP_PHOTO")] }), TODAY)).toEqual(["TEAM_PHOTO"]);
  });

  it("offers nothing without a supplier, and says why a team cannot be asked", () => {
    expect(laundryTeamRequestKinds(teamRun({ hasSupplier: false }), TODAY)).toEqual([]);
    expect(teamRequestBlockedReason(null)).toBe("No laundry partner is recorded for this run.");
    expect(teamRequestBlockedReason({ supplierName: "Fresh Linen", count: 0, names: [] })).toMatch(/^Fresh Linen has no laundry portal users linked.*Chase supplier/);
    expect(teamRequestBlockedReason({ supplierName: "Fresh Linen", count: 1, names: ["Tom"] })).toBeNull();
  });

  it("uses one key per run, kind and cool-down window", () => {
    const at = Date.parse("2026-11-11T01:05:00Z");
    expect(nudgeIdempotencyKey("t1", "ASK_CLEANER", at)).toBe(nudgeIdempotencyKey("t1", "ASK_CLEANER", at + 60_000));
    expect(nudgeIdempotencyKey("t1", "ASK_CLEANER", at)).not.toBe(nudgeIdempotencyKey("t1", "REQUEST_PHOTO", at));
    expect(nudgeIdempotencyKey("t1", "ASK_CLEANER", at)).not.toBe(nudgeIdempotencyKey("t1", "ASK_CLEANER", at + NUDGE_COOL_DOWN_MINUTES * 60_000));
  });
});

describe("server cool-down", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.task.mockResolvedValue({ id: "t1", jobId: "j1", job: { jobNumber: "J-1", property: { name: "Bondi" }, assignments: [{ user: { id: "c1", role: "CLEANER", name: "Ana", email: null, isActive: true } }] } });
    m.office.mockResolvedValue([{ userId: "c1", name: "Ana", transport: "INBOX", path: "pipeline", state: "queued" }]);
    m.recent.mockResolvedValue(null);
  });

  it("refuses a second nudge of the same kind within the cool-down, naming the first time", async () => {
    m.recent.mockResolvedValue({ createdAt: new Date("2026-11-11T01:05:00Z"), after: { kind: "ASK_CLEANER", idempotencyKey: "nudge:t1:ASK_CLEANER:1" } });
    await expect(sendLaundryCleanerNudge("ops-1", { laundryTaskId: "t1", kind: "ASK_CLEANER", transports: ["PUSH"], idempotencyKey: "nudge:t1:ASK_CLEANER:2" }))
      .rejects.toMatchObject({ status: 409, message: "Already asked at 12:05. You can ask again after 12:35." });
    expect(m.office).not.toHaveBeenCalled();
    expect(m.recent.mock.calls[0][0].where).toMatchObject({ action: "LAUNDRY_CLEANER_NUDGE_SENT", entityId: "t1", after: { path: ["kind"], equals: "ASK_CLEANER" } });
  });

  it("lets a retry of the same request through (same key) and records the key", async () => {
    m.recent.mockResolvedValue({ createdAt: new Date(), after: { kind: "ASK_CLEANER", idempotencyKey: "nudge:t1:ASK_CLEANER:1" } });
    const result = await sendLaundryCleanerNudge("ops-1", { laundryTaskId: "t1", kind: "ASK_CLEANER", transports: ["PUSH"], idempotencyKey: "nudge:t1:ASK_CLEANER:1" });
    expect(result.outcomes[0].state).toBe("queued");
    expect(m.office.mock.calls[0][0].eventId).toBe("laundry-nudge:t1:ASK_CLEANER:nudge:t1:ASK_CLEANER:1");
    expect(m.audit.mock.calls[0][0].data.after).toMatchObject({ kind: "ASK_CLEANER", idempotencyKey: "nudge:t1:ASK_CLEANER:1", deliveryConfirmed: false });
  });
});
