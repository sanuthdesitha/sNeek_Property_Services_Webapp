// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  raw: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  routes: vi.fn(),
  suppliers: vi.fn(),
  users: vi.fn(),
  settings: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const tx = { $queryRaw: m.raw, laundryTask: { findUnique: m.findUnique, update: m.update }, auditLog: { create: m.audit } };
  return {
    db: {
      $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
      laundryTask: { findMany: m.findMany, count: m.count },
      laundryRoute: { findMany: m.routes },
      laundrySupplier: { findMany: m.suppliers },
      user: { findMany: m.users },
    },
  };
});
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));

import { rescheduleLaundryRuns, STALE_RUN_MESSAGE } from "@/lib/laundry/reschedule";
import { loadLaundryPipeline } from "@/lib/laundry/pipeline-server";

const seen = new Date("2026-11-10T00:00:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
  m.update.mockImplementation(async ({ data }: { data: { pickupDate: Date; dropoffDate: Date } }) => ({ ...data, updatedAt: new Date("2026-11-11T00:00:00Z") }));
  m.settings.mockResolvedValue({ laundryOperations: { maxOutdoorDays: 3 }, laundryPortalVisibility: { requireDropoffPhoto: true } });
  m.users.mockResolvedValue([]);
  m.suppliers.mockResolvedValue([{ id: "s1", name: "CleanCo" }]);
  m.count.mockResolvedValue(0);
});

describe("rescheduleLaundryRuns", () => {
  it("returns per-row outcomes: moved, refused stale, refused delivered, refused missing", async () => {
    m.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "missing") return null;
      return {
        id: where.id,
        jobId: "j",
        status: where.id === "done" ? "DROPPED" : "CONFIRMED",
        pickupDate: new Date("2026-11-11T00:00:00Z"),
        dropoffDate: new Date("2026-11-13T00:00:00Z"),
        pickedUpAt: null,
        updatedAt: where.id === "stale" ? new Date("2026-11-10T09:00:00Z") : seen,
      };
    });
    const results = await rescheduleLaundryRuns(
      ["ok", "stale", "done", "missing"].map((id) => ({ id, expectedUpdatedAt: seen.toISOString() })),
      "2026-11-12",
      "admin",
    );
    expect(results.map((row) => row.outcome)).toEqual(["done", "refused", "refused", "refused"]);
    expect(results[1]).toMatchObject({ reason: STALE_RUN_MESSAGE });
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.update.mock.calls[0][0].data).toEqual({ pickupDate: new Date("2026-11-12T00:00:00.000Z"), dropoffDate: new Date("2026-11-14T00:00:00.000Z") });
    expect(m.audit.mock.calls[0][0].data.action).toBe("LAUNDRY_RESCHEDULE");
    expect(m.raw).toHaveBeenCalledTimes(4);
  });
});

describe("loadLaundryPipeline", () => {
  const base = { property: { id: "p", name: "Coogee Terrace", accessInfo: null, laundryEnabled: true, client: null }, supplier: null, confirmations: [], job: null, updatedAt: seen, pickedUpAt: null, droppedAt: null };
  it("puts each run in its lane with real counts, filters, the day's summary and the Approvals count", async () => {
    m.findMany.mockResolvedValue([
      { ...base, id: "a", status: "PENDING", pickupDate: new Date("2026-11-11T00:00:00Z"), dropoffDate: new Date("2026-11-13T00:00:00Z") },
      { ...base, id: "b", status: "FLAGGED", pickupDate: new Date("2026-11-09T00:00:00Z"), dropoffDate: new Date("2026-11-11T00:00:00Z"), property: { ...base.property, name: "Bronte" } },
      { ...base, id: "c", status: "PICKED_UP", pickupDate: new Date("2026-11-10T00:00:00Z"), pickedUpAt: new Date("2026-11-10T01:00:00Z"), dropoffDate: new Date("2026-11-11T00:00:00Z"), supplier: { id: "s1", name: "CleanCo", avgTurnaround: 48 } },
      { ...base, id: "d", status: "SKIPPED_PICKUP", pickupDate: new Date("2026-11-11T00:00:00Z"), dropoffDate: new Date("2026-11-12T00:00:00Z") },
    ]);
    m.routes.mockResolvedValue([{ userId: "u1", user: { name: "Tom" }, stops: [{ taskId: "c", kind: "DROP", order: 0, propertyId: "p" }] }]);
    m.count.mockImplementation(async ({ where }: { where: { status?: string } }) => (where.status === "FLAGGED" ? 1 : 2));
    const now = new Date("2026-11-11T03:00:00Z");
    const data = await loadLaundryPipeline("2026-11-11", {}, { role: "ADMIN" as never, userId: "admin" }, now);
    expect(data.counts).toEqual({ pickup: 2, laundry: 0, drop: 1, delivered: 0 });
    expect(data.summary).toEqual({ pickups: 2, drops: 1, exceptions: 1 });
    expect(data.approvalsFlagged).toBe(1);
    expect(data.lanes.drop[0].driver).toMatchObject({ driverName: "Tom", stop: 1 });
    expect(data.lanes.pickup.find((card) => card.id === "b")?.carriedIn).toBe(true);
    expect(data.lanes.pickup[0]).not.toHaveProperty("job.internalNotes");

    const filtered = await loadLaundryPipeline("2026-11-11", { q: "bronte", driverId: null }, { role: "ADMIN" as never, userId: "admin" }, now);
    expect(filtered.counts).toEqual({ pickup: 1, laundry: 0, drop: 0, delivered: 0 });
    expect(filtered.summary.pickups).toBe(2);
    const byDriver = await loadLaundryPipeline("2026-11-11", { driverId: "u1" }, { role: "ADMIN" as never, userId: "admin" }, now);
    expect(byDriver.counts.drop).toBe(1);
    expect(byDriver.counts.pickup).toBe(0);
  });
});
