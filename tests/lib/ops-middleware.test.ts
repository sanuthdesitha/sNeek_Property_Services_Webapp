import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";
const tokenState = vi.hoisted(() => ({ role: "OPS_MANAGER" }));
vi.mock("next-auth/middleware", () => ({ withAuth: (handler: any) => async (req: any) => { req.nextauth = { token: { id: "manager", role: tokenState.role } }; return handler(req); } }));
vi.mock("@/lib/auth/impersonation", () => ({ IMPERSONATION_COOKIE: "sneek.test-as", readImpersonationTicket: async () => null, isReadOnlySafeMethod: (method: string) => method === "GET" }));
import middleware from "@/middleware";
const request = (path: string, method = "GET") => new NextRequest(`https://example.invalid${path}`, { method, headers: { "x-sneek-request-path": "/api/me/profile", "x-sneek-request-method": "GET" } });
const event = {} as any;
beforeEach(() => { tokenState.role = "OPS_MANAGER"; });
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ valid: true, id: "manager", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"], opsAccess: { ...allOpsLevels("read"), finance: "off" } }), { status: 200 }))));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("blocks direct writes and disabled reads before legacy handlers execute", async () => {
  expect((await middleware(request("/api/admin/jobs/job", "PATCH"), event)).status).toBe(403);
  expect((await middleware(request("/api/admin/finance"), event)).status).toBe(403);
  expect((await middleware(request("/api/admin/jobs/job"), event)).headers.get("x-middleware-next")).toBe("1");
});
it("overwrites forged request scope and enforces retained-account permissions", async () => {
  const response = await middleware(request("/api/admin/jobs/job"), event);
  expect(response.headers.get("x-middleware-request-x-sneek-request-path")).toBe("/api/admin/jobs/job");
  const prefix = `/_accounts/${"a".repeat(32)}`;
  expect((await middleware(request(`${prefix}/api/admin/jobs/job`, "POST"), event)).status).toBe(403);
  expect((await middleware(request(`${prefix}/v2/admin/finance`), event)).headers.get("location")).toBe(`https://example.invalid${prefix}/v2/admin/access-denied`);
});
it("fails closed on an unavailable live permission lookup", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  expect((await middleware(request("/api/admin/jobs"), event)).status).toBe(503);
  expect((await middleware(request("/v2/admin/jobs"), event)).status).toBe(503);
});


it.each([
  ["/api/jobs?paginated=1&page=1&limit=50", "GET"],
  ["/api/admin/integrations/ical-sync-runs", "GET"],
  ["/api/admin/test-as/unlock", "POST"],
])("validates owner access internally when the public host is unreachable: %s", async (path, method) => {
  tokenState.role = "ADMIN";
  vi.stubEnv("NEXTAUTH_URL_INTERNAL", "http://127.0.0.1:3000");
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (new URL(String(url)).origin !== "http://127.0.0.1:3000") throw new Error("Public host unreachable");
    return new Response(JSON.stringify({ valid: true, role: "ADMIN", opsAccess: null }));
  });
  const response = await middleware(request(path, method), event);
  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(response.headers.get("x-middleware-request-x-sneek-request-path")).toBe(path);
  expect(fetch).toHaveBeenCalledWith(new URL("http://127.0.0.1:3000/api/auth/validate-session"), expect.objectContaining({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) }));
});
it("does not downgrade permission checks when using the internal transport", async () => {
  vi.stubEnv("NEXTAUTH_URL_INTERNAL", "http://127.0.0.1:3000");
  expect((await middleware(request("/api/admin/finance"), event)).status).toBe(403);
  vi.mocked(fetch).mockRejectedValue(new Error("internal offline"));
  tokenState.role = "ADMIN";
  expect((await middleware(request("/api/jobs"), event)).status).toBe(503);
});
it("distinguishes validation outages from revoked sessions", async () => {
  tokenState.role = "ADMIN";
  vi.mocked(fetch).mockResolvedValue(new Response("unavailable", { status: 500 }));
  expect((await middleware(request("/api/jobs"), event)).status).toBe(503);
  vi.mocked(fetch).mockResolvedValue(new Response("revoked", { status: 401 }));
  expect((await middleware(request("/api/jobs"), event)).status).toBe(401);
});
it("uses the trusted internal destination for retained accounts too", async () => {
  vi.stubEnv("NEXTAUTH_URL_INTERNAL", "http://127.0.0.1:3000");
  const id = "a".repeat(32);
  const response = await middleware(request(`/_accounts/${id}/api/jobs`), event);
  expect(response.headers.get("x-middleware-rewrite")).toBe("https://example.invalid/api/jobs");
  expect(fetch).toHaveBeenCalledWith(new URL(`http://127.0.0.1:3000/api/auth/retained/validate?context=${id}`), expect.objectContaining({ redirect: "error" }));
});
