// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(),
  createRun: vi.fn(), updateRun: vi.fn(), requireRole: vi.fn(), fetch: vi.fn(),
  findRuns: vi.fn(), updateRuns: vi.fn(), updateIntegrations: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  integration: { findMany: mocks.findMany, findUnique: mocks.findUnique, update: mocks.update, updateMany: mocks.updateIntegrations },
  icalSyncRun: { create: mocks.createRun, update: mocks.updateRun, findMany: mocks.findRuns, updateMany: mocks.updateRuns },
} }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { closeInterruptedIcalRuns, syncAllIcal, syncPropertyIcal } from "@/lib/ical/sync";
import { POST } from "@/app/api/admin/properties/[id]/integration/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.findUnique.mockImplementation(async ({ where }) => ({
    id: where.id ?? "feed-manual", propertyId: "property", isEnabled: true,
    icalUrl: "https://calendar.example.test/feed.ics", notes: null,
  }));
  mocks.createRun.mockImplementation(async ({ data }) => ({ id: `run-${data.integrationId}` }));
  mocks.update.mockResolvedValue({});
  mocks.updateRun.mockResolvedValue({});
  mocks.fetch.mockResolvedValue(new Response(null, { status: 304 }));
  mocks.requireRole.mockResolvedValue({ user: { id: "admin" } });
  mocks.findRuns.mockResolvedValue([]);
  mocks.updateRuns.mockResolvedValue({ count: 1 });
  mocks.updateIntegrations.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllGlobals());

it("automatically sweeps enabled feeds and records AUTO success independently of a failed feed", async () => {
  mocks.findMany.mockResolvedValue([{ id: "bad", propertyId: "one" }, { id: "good", propertyId: "two" }]);
  mocks.fetch.mockRejectedValueOnce(new Error("feed unavailable"));
  await syncAllIcal();
  expect(mocks.findMany).toHaveBeenCalledWith({
    where: { isEnabled: true, icalUrl: { not: null } }, select: { id: true, propertyId: true },
  });
  expect(mocks.createRun).toHaveBeenCalledTimes(2);
  for (const [call] of mocks.createRun.mock.calls) expect(call.data).toMatchObject({ mode: "AUTO", triggeredById: null });
  expect(mocks.updateRun).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run-bad" }, data: expect.objectContaining({ status: "ERROR" }) }));
  expect(mocks.updateRun).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run-good" }, data: expect.objectContaining({ status: "SUCCESS" }) }));
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "good" }, data: expect.objectContaining({ lastSyncAt: expect.any(Date), syncStatus: "SUCCESS" }) });
});

it("manual Sync now uses the same service with actor attribution", async () => {
  const response = await POST(new NextRequest("http://localhost/api/admin/properties/property/integration", { method: "POST" }), { params: { id: "property" } });
  expect(response.status).toBe(200);
  expect(mocks.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
  expect(mocks.createRun).toHaveBeenCalledWith({ data: expect.objectContaining({ integrationId: "feed-manual", mode: "MANUAL", triggeredById: "admin" }) });
  expect(mocks.fetch).toHaveBeenCalledOnce();
});

it("manual sync still rejects unauthorized callers without fetching a feed", async () => {
  mocks.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
  const response = await POST(new NextRequest("http://localhost/api/admin/properties/property/integration", { method: "POST" }), { params: { id: "property" } });
  expect(response.status).toBe(403);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("releases every pool slot when feeds send headers but stall their response bodies", async () => {
  vi.useFakeTimers();
  try {
    mocks.findMany.mockResolvedValue(Array.from({ length: 5 }, (_, i) => ({ id: `feed-${i}`, propertyId: `property-${i}` })));
    mocks.fetch.mockImplementation(async (_url, { signal }) => {
      const body = new ReadableStream({
        start(controller) {
          signal.addEventListener("abort", () => controller.error(new Error("Feed body timed out")), { once: true });
        },
      });
      return new Response(body, { status: 200 });
    });
    let settled = false;
    const sweep = syncAllIcal().then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(mocks.fetch).toHaveBeenCalledTimes(5);
    expect(settled).toBe(true);
    expect(mocks.updateRun.mock.calls.filter(([arg]) => arg.data.status === "ERROR")).toHaveLength(5);
    await sweep;
  } finally {
    vi.useRealTimers();
  }
});

it("keeps the feed validators after an unchanged response so the next run stays conditional", async () => {
  mocks.findUnique.mockResolvedValue({
    id: "feed", propertyId: "property", isEnabled: true, icalUrl: "https://calendar.example.test/feed.ics",
    notes: null, lastSyncEtag: '"v7"', lastSyncModified: "Tue, 10 Nov 2026 00:00:00 GMT",
  });
  await syncPropertyIcal("feed", { mode: "AUTO" });
  expect(mocks.fetch.mock.calls[0][1].headers).toMatchObject({ "If-None-Match": '"v7"' });
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "feed" }, data: expect.objectContaining({
    syncStatus: "SUCCESS", lastSyncEtag: '"v7"', lastSyncModified: "Tue, 10 Nov 2026 00:00:00 GMT",
  }) });
});

it("records a run whose worker died as an error instead of leaving it running forever", async () => {
  const now = new Date("2026-11-10T02:00:00Z");
  mocks.findRuns.mockResolvedValue([{ id: "stuck", integrationId: "feed" }]);
  expect(await closeInterruptedIcalRuns(now)).toBe(1);
  expect(mocks.findRuns).toHaveBeenCalledWith(expect.objectContaining({
    where: { status: "RUNNING", createdAt: { lt: new Date("2026-11-10T01:40:00Z") } },
  }));
  expect(mocks.updateRuns).toHaveBeenCalledWith({
    where: { id: "stuck", status: "RUNNING" },
    data: expect.objectContaining({ status: "ERROR", completedAt: now, error: expect.stringContaining("interrupted") }),
  });
  expect(mocks.updateIntegrations).toHaveBeenCalledWith({
    where: { id: "feed", syncStatus: "SYNCING" },
    data: expect.objectContaining({ syncStatus: "ERROR" }),
  });
});

it("does not touch a feed whose interrupted run was already closed by another worker", async () => {
  mocks.findRuns.mockResolvedValue([{ id: "stuck", integrationId: "feed" }]);
  mocks.updateRuns.mockResolvedValue({ count: 0 });
  await closeInterruptedIcalRuns(new Date("2026-11-10T02:00:00Z"));
  expect(mocks.updateIntegrations).not.toHaveBeenCalled();
});

it("still syncs every feed when closing interrupted runs fails", async () => {
  mocks.findRuns.mockRejectedValue(new Error("history unavailable"));
  mocks.findMany.mockResolvedValue([{ id: "good", propertyId: "two" }]);
  await syncAllIcal();
  expect(mocks.updateRun).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "run-good" }, data: expect.objectContaining({ status: "SUCCESS" }) }));
});
