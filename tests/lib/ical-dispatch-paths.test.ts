// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(),
  createRun: vi.fn(), updateRun: vi.fn(), requireRole: vi.fn(), fetch: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  integration: { findMany: mocks.findMany, findUnique: mocks.findUnique, update: mocks.update },
  icalSyncRun: { create: mocks.createRun, update: mocks.updateRun },
} }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { syncAllIcal } from "@/lib/ical/sync";
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
