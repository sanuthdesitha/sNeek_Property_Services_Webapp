import { describe, it, expect } from "vitest";
import {
  selectAdminAttentionTasks,
  selectStaleDriverTasks,
  sydneyTodayUtcKey,
} from "@/lib/laundry/reminders";

// 2026-07-25 15:00 Sydney (AEST, UTC+10) — the driver-nudge dispatch context.
const NOW = new Date("2026-07-25T05:00:00Z");
const TODAY = "2026-07-25T00:00:00.000Z"; // UTC-midnight day key, same Sydney day
const TOMORROW = "2026-07-26T00:00:00.000Z";
const YESTERDAY = "2026-07-24T00:00:00.000Z";

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

function task(overrides: Partial<Parameters<typeof selectStaleDriverTasks>[0][number]> = {}) {
  return {
    id: "t1",
    status: "PENDING",
    pickupDate: TODAY,
    dropoffDate: TOMORROW,
    pickedUpAt: null,
    updatedAt: NOW,
    noPickupRequired: false,
    property: { name: "Harbour Terrace", suburb: "Kirribilli" },
    ...overrides,
  };
}

describe("selectStaleDriverTasks", () => {
  it("includes tasks due today still PENDING/CONFIRMED", () => {
    const tasks = [
      task({ id: "a", status: "PENDING", pickupDate: TODAY }),
      task({ id: "b", status: "CONFIRMED", pickupDate: YESTERDAY, dropoffDate: TODAY }),
    ];
    expect(selectStaleDriverTasks(tasks, NOW).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("excludes tasks due tomorrow or already progressed", () => {
    const tasks = [
      task({ id: "a", status: "PENDING", pickupDate: TOMORROW, dropoffDate: TOMORROW }),
      task({ id: "b", status: "DROPPED", pickupDate: TODAY, dropoffDate: TODAY }),
      task({ id: "c", status: "SKIPPED_PICKUP", pickupDate: TODAY, dropoffDate: TODAY }),
    ];
    expect(selectStaleDriverTasks(tasks, NOW)).toHaveLength(0);
  });

  it("ignores the pickup leg for noPickupRequired tasks", () => {
    const tasks = [
      task({ id: "a", noPickupRequired: true, pickupDate: TODAY, dropoffDate: TOMORROW }),
      task({ id: "b", noPickupRequired: true, pickupDate: TODAY, dropoffDate: TODAY }),
    ];
    expect(selectStaleDriverTasks(tasks, NOW).map((t) => t.id)).toEqual(["b"]);
  });

  it("includes PICKED_UP tasks held for more than 24h, not fresher ones", () => {
    const tasks = [
      task({ id: "old", status: "PICKED_UP", pickedUpAt: hoursAgo(30) }),
      task({ id: "fresh", status: "PICKED_UP", pickedUpAt: hoursAgo(5) }),
      task({ id: "nostamp", status: "PICKED_UP", pickedUpAt: null }),
    ];
    expect(selectStaleDriverTasks(tasks, NOW).map((t) => t.id)).toEqual(["old"]);
  });
});

describe("selectAdminAttentionTasks", () => {
  it("includes open tasks untouched for more than 48h", () => {
    const tasks = [
      task({ id: "stale", status: "PENDING", updatedAt: hoursAgo(72) }),
      task({ id: "picked", status: "PICKED_UP", updatedAt: hoursAgo(49) }),
      task({ id: "recent", status: "PENDING", updatedAt: hoursAgo(24) }),
    ];
    expect(selectAdminAttentionTasks(tasks, NOW).map((t) => t.id)).toEqual(["stale", "picked"]);
  });

  it("never includes DROPPED or SKIPPED tasks however old", () => {
    const tasks = [
      task({ id: "a", status: "DROPPED", updatedAt: hoursAgo(200) }),
      task({ id: "b", status: "SKIPPED_PICKUP", updatedAt: hoursAgo(200) }),
    ];
    expect(selectAdminAttentionTasks(tasks, NOW)).toHaveLength(0);
  });
});

describe("sydneyTodayUtcKey", () => {
  it("returns the UTC-midnight key of the Sydney calendar day", () => {
    // 2026-07-25 05:00Z is 15:00 Sydney on the 25th.
    expect(sydneyTodayUtcKey(NOW).toISOString()).toBe("2026-07-25T00:00:00.000Z");
    // 2026-07-25 20:00Z is already 06:00 Sydney on the 26th.
    expect(sydneyTodayUtcKey(new Date("2026-07-25T20:00:00Z")).toISOString()).toBe(
      "2026-07-26T00:00:00.000Z",
    );
  });
});
