// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), jobs: vi.fn(), ping: vi.fn(), user: vi.fn(), resolve: vi.fn(), fence: vi.fn(), departure: vi.fn(), key: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth, requireSession: m.auth }));
vi.mock("@/lib/db", () => ({ db: { job: { findMany: m.jobs }, cleanerLocationPing: { createMany: m.ping }, user: { update: m.user }, uploadFailure: { update: m.resolve } } }));
vi.mock("@/lib/gps/geofence", () => ({ checkGeofenceForPing: m.fence }));
vi.mock("@/lib/gps/departure-clockout", () => ({ handleGeofenceDeparture: m.departure }));
vi.mock("@/lib/maps/server-key", () => ({ getServerMapsKey: m.key }));
import { POST as ping } from "@/app/api/cleaner/location/ping/route";
import { POST as resolve } from "@/app/api/admin/system/uploads/[id]/resolve/route";
import { POST as geocode } from "@/app/api/geocode/lookup/route";
const req = (data: unknown) => new NextRequest("http://localhost", { method: "POST", body: JSON.stringify(data) });
const point = { jobId: "owned", lat: -33, lng: 151 };
beforeEach(() => {
 vi.resetAllMocks(); vi.stubGlobal("fetch", m.fetch);
 (globalThis as any).__sneekPingRateLimit.clear();
 m.auth.mockResolvedValue({ user: { id: "actor", role: "CLEANER" } });
 m.jobs.mockResolvedValue([{ id: "owned" }]); m.fence.mockResolvedValue({}); m.key.mockResolvedValue("mock-key");
});
afterEach(() => vi.unstubAllGlobals());
it.each([new Error("FORBIDDEN"), "invalid session"])("upload resolution rejects non-admitted session before mutation: %s", async error => {
 m.auth.mockRejectedValue(error);
 expect((await resolve(req({}), { params: { id: "failure" } })).status).toBe(403);
 expect(m.resolve).not.toHaveBeenCalled();
});
it("upload resolution attributes the exact failure to the live office actor", async () => {
 m.auth.mockResolvedValue({ user: { id: "operator", role: "OPS_MANAGER" } });
 expect((await resolve(req({ resolvedBy: "forged" }), { params: { id: "failure" } })).status).toBe(200);
 expect(m.auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
 expect(m.resolve).toHaveBeenCalledWith({ where: { id: "failure" }, data: { resolvedAt: expect.any(Date), resolvedBy: "operator" } });
});
it("GPS rejects revoked identity before ownership reads or ingestion", async () => {
 m.auth.mockRejectedValue(new Error("UNAUTHORIZED"));
 expect((await ping(req(point))).status).toBe(401);
 expect(m.jobs).not.toHaveBeenCalled(); expect(m.ping).not.toHaveBeenCalled();
});
it("GPS stores only assigned jobs under the live user and fences only an owned point", async () => {
 const response = await ping(req([point, { ...point, jobId: "other", lat: 42 }]));
 expect(response.status).toBe(200);
 expect(m.jobs).toHaveBeenCalledWith({ where: { id: { in: ["owned", "other"] }, assignments: { some: { userId: "actor", removedAt: null } } }, select: { id: true } });
 expect(m.ping.mock.calls[0][0].data).toEqual([expect.objectContaining({ jobId: "owned", userId: "actor", lat: -33 })]);
 expect(m.fence).toHaveBeenCalledWith(expect.objectContaining({ userId: "actor", lat: -33 }));
 expect(m.user).toHaveBeenCalledWith({ where: { id: "actor" }, data: { lastSeenAt: expect.any(Date) } });
});
it("GPS silently drops foreign jobs without saving or triggering geofence actions", async () => {
 m.jobs.mockResolvedValue([]);
 expect(await (await ping(req(point))).json()).toEqual({ ok: true, received: 0, dropped: 1 });
 expect(m.ping).not.toHaveBeenCalled(); expect(m.fence).not.toHaveBeenCalled();
});
it("GPS acknowledges committed pings despite geofence failure and rate-limits immediate retries", async () => {
 m.fence.mockRejectedValue(new Error("geofence unavailable"));
 expect((await ping(req(point))).status).toBe(200);
 expect((await ping(req(point))).status).toBe(429);
 expect(m.ping).toHaveBeenCalledOnce();
});
it("GPS acknowledges committed pings despite departure failure", async () => {
 m.fence.mockResolvedValue({ departed: { jobId: "owned", distanceM: 30 } }); m.departure.mockRejectedValue(new Error("departure failed"));
 expect((await ping(req(point))).status).toBe(200);
 expect(m.departure).toHaveBeenCalledWith(expect.objectContaining({ jobId: "owned", userId: "actor", distanceM: 30 }));
});
it("geocode requires a live identity before accessing credentials or provider", async () => {
 m.auth.mockRejectedValue(new Error("FORBIDDEN"));
 expect((await geocode(req({ query: "address" }))).status).toBe(401);
 expect(m.key).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled();
});
it("geocode fails missing configuration without a provider call", async () => {
 m.key.mockResolvedValue(null);
 expect((await geocode(req({ query: "address" }))).status).toBe(500);
 expect(m.fetch).not.toHaveBeenCalled();
});
it("geocode maps authorized provider results using the configured server credential", async () => {
 m.fetch.mockResolvedValue(new Response(JSON.stringify({ places: [{ id: "place", formattedAddress: "Address", location: { latitude: -33, longitude: 151 }, addressComponents: [{ longText: "Australia", shortText: "AU", types: ["country"] }, { longText: "New South Wales", shortText: "NSW", types: ["administrative_area_level_1"] }] }] })));
 const response = await geocode(req({ query: "address" }));
 expect(await response.json()).toMatchObject({ placeId: "place", lat: -33, lng: 151, country: "AU", state: "NSW" });
 expect(m.fetch.mock.calls[0][1].headers["X-Goog-Api-Key"]).toBe("mock-key");
});
it.each([404, 502])("geocode handles provider outcome %s without pretending success", async expected => {
 m.fetch.mockResolvedValue(expected === 404 ? new Response(JSON.stringify({ places: [] })) : new Response("provider unavailable", { status: 503 }));
 expect((await geocode(req({ query: "address" }))).status).toBe(expected);
});
it("GPS rejects malformed input before any job query", async () => {
 expect((await ping(req({ jobId: "owned", lat: "invalid", lng: 151 }))).status).toBe(400);
 expect(m.jobs).not.toHaveBeenCalled(); expect(m.ping).not.toHaveBeenCalled();
});
it("GPS drops offline stale samples before any assignment lookup", async () => {
 expect(await (await ping(req({ ...point, timestamp: new Date(Date.now() - 600_000).toISOString() }))).json()).toEqual({ ok: true, received: 0, dropped: 1 });
 expect(m.jobs).not.toHaveBeenCalled(); expect(m.ping).not.toHaveBeenCalled();
});
it("GPS handles malformed JSON without any writes", async () => {
 expect((await ping(new NextRequest("http://localhost", { method: "POST", body: "{" }))).status).toBe(400);
 expect(m.ping).not.toHaveBeenCalled();
});
it("geocode rejects an invalid query before reading server credentials", async () => {
 expect((await geocode(req({ query: "a" }))).status).toBe(400);
 expect(m.key).not.toHaveBeenCalled(); expect(m.fetch).not.toHaveBeenCalled();
});
