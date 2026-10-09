import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";
vi.mock("next-auth/middleware", () => ({ withAuth: (handler: any) => async (req: any) => { req.nextauth = { token: { id: "manager", role: "OPS_MANAGER" } }; return handler(req); } }));
vi.mock("@/lib/auth/impersonation", () => ({ IMPERSONATION_COOKIE: "sneek.test-as", readImpersonationTicket: async () => null, isReadOnlySafeMethod: (method: string) => method === "GET" }));
import middleware from "@/middleware";
const request = (path: string, method = "GET") => new NextRequest(`https://example.invalid${path}`, { method, headers: { "x-sneek-request-path": "/api/me/profile", "x-sneek-request-method": "GET" } });
const event = {} as any;
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ valid: true, id: "manager", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"], opsAccess: { ...allOpsLevels("read"), finance: "off" } }), { status: 200 }))));
afterEach(() => vi.unstubAllGlobals());
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
