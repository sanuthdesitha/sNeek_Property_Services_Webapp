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

import { laundryNudgeKinds, nudgeIdempotencyKey, NUDGE_COOL_DOWN_MINUTES } from "@/lib/laundry/nudge-rules";
import { sendLaundryCleanerNudge } from "@/lib/notifications/office-actions";
import type { PipelineException } from "@/lib/laundry/pipeline";

const TODAY = "2026-11-11";
const exc = (code: PipelineException["code"]): PipelineException => ({ code, label: code });
const run = (overrides: Partial<Parameters<typeof laundryNudgeKinds>[0]> = {}) => ({
  status: "PENDING", pickupDate: "2026-11-11T00:00:00.000Z", exceptions: [] as PipelineException[], readiness: true as boolean | null, jobStatus: "SUBMITTED", hasJob: true, ...overrides,
});

describe("which nudges a run offers", () => {
  it("offers Ask cleaner only when the pickup is in doubt", () => {
    expect(laundryNudgeKinds(run({ exceptions: [exc("NOT_READY")] }), TODAY)).toEqual(["ASK_CLEANER"]);
    expect(laundryNudgeKinds(run({ exceptions: [exc("PICKUP_OVERDUE")] }), TODAY)).toEqual(["ASK_CLEANER"]);
    // Bags not confirmed on the pickup day, clean finished.
    expect(laundryNudgeKinds(run({ readiness: null }), TODAY)).toEqual(["ASK_CLEANER"]);
    // Nothing in doubt: ready, or the clean is still in progress, or pickup is in the future.
    expect(laundryNudgeKinds(run(), TODAY)).toEqual([]);
    expect(laundryNudgeKinds(run({ readiness: null, jobStatus: "IN_PROGRESS" }), TODAY)).toEqual([]);
    expect(laundryNudgeKinds(run({ readiness: null, pickupDate: "2026-11-13T00:00:00.000Z" }), TODAY)).toEqual([]);
    // Already picked up: the cleaner has nothing to confirm.
    expect(laundryNudgeKinds(run({ status: "PICKED_UP", exceptions: [exc("DROP_OVERDUE")] }), TODAY)).toEqual([]);
  });

  it("offers Request photo only for a delivery without the required drop photo", () => {
    expect(laundryNudgeKinds(run({ status: "DROPPED", exceptions: [exc("NO_DROP_PHOTO")] }), TODAY)).toEqual(["REQUEST_PHOTO"]);
    expect(laundryNudgeKinds(run({ status: "DROPPED" }), TODAY)).toEqual([]);
  });

  it("offers nothing for a run without a linked job (no cleaner to ask)", () => {
    expect(laundryNudgeKinds(run({ hasJob: false, exceptions: [exc("NOT_READY")] }), TODAY)).toEqual([]);
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
