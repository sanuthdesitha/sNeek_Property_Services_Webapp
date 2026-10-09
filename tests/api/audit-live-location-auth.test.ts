// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ access: vi.fn(), auth: vi.fn(), user: vi.fn(), pings: vi.fn(), logs: vi.fn(), jobs: vi.fn() }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.access }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user }, cleanerLocationPing: { findMany: m.pings }, timeLog: { findMany: m.logs }, job: { findMany: m.jobs } } }));
import { allOpsLevels } from "@/lib/rbac/ops-catalog";
import { GET as snapshot } from "@/app/api/admin/ops/live-locations/route";
import { GET as stream } from "@/app/api/admin/ops/live-locations/stream/route";
beforeEach(() => { vi.resetAllMocks(); m.access.mockResolvedValue(null); m.auth.mockResolvedValue({ user: { id: "office", role: "ADMIN" } }); });
afterEach(() => vi.useRealTimers());
it.each(["UNAUTHORIZED", "FORBIDDEN"])("live location endpoints stop before querying pings when %s", async error => {
  m.auth.mockRejectedValue(new Error(error));
  expect((await snapshot()).status).toBe(error === "UNAUTHORIZED" ? 401 : 403);
  expect((await stream(new NextRequest("http://local"))).status).toBe(error === "UNAUTHORIZED" ? 401 : 403);
  expect(m.logs).not.toHaveBeenCalled(); expect(m.pings).not.toHaveBeenCalled();
});
it("requires live office authorization for the empty snapshot", async () => {
  m.logs.mockResolvedValue([]); m.jobs.mockResolvedValue([]);
  expect(await (await snapshot()).json()).toEqual({ pings: [] });
  expect(m.auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
});
it.each([{ isActive: false, role: "ADMIN" }, { isActive: true, role: "CLEANER" }, null])("closes an existing stream on revoked live access %j", async live => {
  vi.useFakeTimers(); m.user.mockResolvedValue(live);
  const controller = new AbortController();
  const response = await stream(new NextRequest("http://local", { signal: controller.signal }));
  const reader = response.body!.getReader();
  expect((await reader.read()).done).toBe(false);
  await vi.advanceTimersByTimeAsync(15_000);
  expect((await reader.read()).done).toBe(true);
  expect(m.pings).not.toHaveBeenCalled(); controller.abort();
});
it("rechecks an authorized actor and closes cleanly on client disconnect", async () => {
  vi.useFakeTimers(); m.user.mockResolvedValue({ isActive: true, role: "OPS_MANAGER" }); m.pings.mockResolvedValue([]);
  const controller = new AbortController();
  const response = await stream(new NextRequest("http://local", { signal: controller.signal }));
  const reader = response.body!.getReader(); await reader.read();
  await vi.advanceTimersByTimeAsync(15_000); expect(m.pings).toHaveBeenCalledTimes(1);
  controller.abort(); expect((await reader.read()).done).toBe(true);
});

it("closes an open location stream when its operations feature access is revoked", async () => {
  vi.useFakeTimers();
  m.user.mockResolvedValue({ isActive: true, role: "OPS_MANAGER" });
  m.access.mockResolvedValue(allOpsLevels("off"));
  const controller = new AbortController();
  const response = await stream(new NextRequest("http://local", { signal: controller.signal }));
  const reader = response.body!.getReader();
  await reader.read();
  await vi.advanceTimersByTimeAsync(15_000);
  expect((await reader.read()).done).toBe(true);
  expect(m.pings).not.toHaveBeenCalled();
  controller.abort();
});
