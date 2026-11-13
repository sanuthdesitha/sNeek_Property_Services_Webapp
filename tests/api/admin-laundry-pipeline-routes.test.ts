// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ role: vi.fn(), move: vi.fn(), load: vi.fn(), findUnique: vi.fn(), update: vi.fn(), pings: vi.fn(), tasks: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/laundry/reschedule", () => ({ rescheduleLaundryRuns: m.move }));
vi.mock("@/lib/laundry/pipeline-server", () => ({ loadLaundryPipeline: m.load }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/db", () => ({
  db: {
    laundryTask: { findUnique: m.findUnique, update: m.update, findMany: m.tasks },
    cleanerLocationPing: { findMany: m.pings },
    // Drivers now come from ACTIVE routes (live location 2026-11).
    laundryRoute: { findMany: m.pings },
  },
}));

import { POST as reschedule } from "@/app/api/admin/laundry/reschedule/route";
import { GET as pipeline } from "@/app/api/admin/laundry/pipeline/route";
import { PATCH as patchTask } from "@/app/api/admin/laundry/[taskId]/route";
import { GET as live } from "@/app/api/admin/laundry/live/route";

const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) }) as never;

beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
});

describe("POST /api/admin/laundry/reschedule", () => {
  it("returns the per-row outcomes from the service", async () => {
    m.move.mockResolvedValue([{ id: "a", outcome: "refused", reason: "changed" }]);
    const response = await reschedule(post({ toDate: "2026-11-12", rows: [{ id: "a", expectedUpdatedAt: "2026-11-10T00:00:00.000Z" }] }));
    expect(response.status).toBe(200);
    expect((await response.json()).results[0].outcome).toBe("refused");
    expect(m.move).toHaveBeenCalledWith([{ id: "a", expectedUpdatedAt: "2026-11-10T00:00:00.000Z" }], "2026-11-12", "admin");
  });
  it("refuses a request without the stale-write version or day", async () => {
    expect((await reschedule(post({ toDate: "2026-11-12", rows: [{ id: "a" }] }))).status).toBe(400);
    expect((await reschedule(post({ toDate: "tomorrow", rows: [{ id: "a", expectedUpdatedAt: "2026-11-10T00:00:00.000Z" }] }))).status).toBe(400);
    expect(m.move).not.toHaveBeenCalled();
  });
  it("refuses non-office roles", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await reschedule(post({}))).status).toBe(403);
  });
});

describe("GET /api/admin/laundry/pipeline", () => {
  it("refuses a malformed day", async () => {
    expect((await pipeline(new Request("http://x/api/admin/laundry/pipeline?date=11-11-2026") as never)).status).toBe(400);
  });
  it("passes the day and filters through", async () => {
    m.load.mockResolvedValue({ ok: true });
    await pipeline(new Request("http://x/api/admin/laundry/pipeline?date=2026-11-12&q=coogee&supplierId=s1") as never);
    expect(m.load).toHaveBeenCalledWith("2026-11-12", { q: "coogee", supplierId: "s1", driverId: null }, { role: "ADMIN", userId: "admin" });
  });
});

describe("PATCH /api/admin/laundry/[taskId] stale-write guard", () => {
  it("refuses an edit to a run that changed since it was opened", async () => {
    m.findUnique.mockResolvedValue({ id: "t", jobId: "j", property: { name: "P" }, status: "PENDING", updatedAt: new Date("2026-11-10T05:00:00Z") });
    const response = await patchTask(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ pickupDate: "2026-11-12T00:00:00.000Z", expectedUpdatedAt: "2026-11-10T00:00:00.000Z" }) }) as never,
      { params: { taskId: "t" } },
    );
    expect(response.status).toBe(409);
    expect(m.update).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/laundry/live", () => {
  it("bounds today's stops by the Sydney day, not the server's", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T20:00:00Z")); // 07:00 on 12 Nov in Sydney
    m.pings.mockResolvedValue([]);
    m.tasks.mockResolvedValue([]);
    m.settings.mockResolvedValue({ laundryOperations: { maxOutdoorDays: 3 } });
    try {
      await live();
      const where = m.tasks.mock.calls[0][0].where.OR[0].pickupDate;
      expect(where.gte.toISOString()).toBe("2026-11-11T13:00:00.000Z");
      expect(where.lt.toISOString()).toBe("2026-11-12T13:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});
