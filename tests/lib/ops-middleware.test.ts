import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";
const tokenState = vi.hoisted(() => ({ role: "OPS_MANAGER", readOnly: false }));
vi.mock("next-auth/middleware", () => ({ withAuth: (handler: any) => async (req: any) => { req.nextauth = { token: { id: "manager", role: tokenState.role } }; return handler(req); } }));
vi.mock("@/lib/auth/impersonation", () => ({ IMPERSONATION_COOKIE: "sneek.test-as", readImpersonationTicket: async () => tokenState.readOnly ? { mode: "READ_ONLY" } : null, isReadOnlySafeMethod: (method: string) => method === "GET" }));
import middleware from "@/middleware";
const request = (path: string, method = "GET") => new NextRequest(`https://example.invalid${path}`, { method, headers: { "x-sneek-request-path": "/api/me/profile", "x-sneek-request-method": "GET" } });
const event = {} as any;
beforeEach(() => { tokenState.role = "OPS_MANAGER"; tokenState.readOnly = false; });
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ valid: true, id: "manager", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"], opsAccess: { ...allOpsLevels("read"), finance: "off" } }), { status: 200 }))));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each([
  ["/api/jobs?paginated=1", "GET"],
  ["/api/admin/integrations/ical-sync-runs", "GET"],
  ["/api/admin/test-as/unlock", "POST"],
  ["/api/admin/jobs/job", "PATCH"],
  ["/api/admin/finance", "GET"],
  ["/api/admin/ops-permissions", "PUT"],
])("delegates %s to live server authorization even when the HTTP callback is offline", async (path, method) => {
  tokenState.role = "ADMIN";
  vi.mocked(fetch).mockRejectedValue(new Error("callback offline"));
  const response = await middleware(request(path, method), event);
  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(response.headers.get("x-middleware-request-x-sneek-request-path")).toBe(path);
  expect(response.headers.get("x-middleware-request-x-sneek-request-method")).toBe(method);
  expect(fetch).not.toHaveBeenCalled();
});
it("forwards OPS API requests to local live policy enforcement, not an HTTP callback", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  expect((await middleware(request("/api/admin/finance"), event)).headers.get("x-middleware-next")).toBe("1");
  expect(fetch).not.toHaveBeenCalled();
  expect((await middleware(request("/v2/admin/jobs"), event)).status).toBe(503);
});
it("preserves retained-account validation and page permission checks", async () => {
  const prefix = `/_accounts/${"a".repeat(32)}`;
  const response = await middleware(request(`${prefix}/api/admin/jobs/job`, "POST"), event);
  expect(response.headers.get("x-middleware-request-x-sneek-request-path")).toBe("/api/admin/jobs/job");
  expect(response.headers.get("x-middleware-request-x-sneek-request-method")).toBe("POST");
  expect((await middleware(request(`${prefix}/v2/admin/finance`), event)).headers.get("location")).toBe(`https://example.invalid${prefix}/v2/admin/access-denied`);
});
it("still validates owner navigation via the internal transport when reachable", async () => {
  tokenState.role = "ADMIN";
  vi.stubEnv("NEXTAUTH_URL_INTERNAL", "http://127.0.0.1:3000");
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ valid: true, role: "ADMIN", heldRoles: ["ADMIN"], opsAccess: null, defaultPortalVersion: "v2" })));
  expect((await middleware(request("/v2/admin/jobs"), event)).headers.get("x-middleware-next")).toBe("1");
  expect(fetch).toHaveBeenCalledWith(new URL("http://127.0.0.1:3000/api/auth/validate-session"), expect.objectContaining({ redirect: "error", cache: "no-store" }));
});
it("uses the trusted internal destination for retained accounts too", async () => {
  vi.stubEnv("NEXTAUTH_URL_INTERNAL", "http://127.0.0.1:3000");
  const id = "a".repeat(32);
  const response = await middleware(request(`/_accounts/${id}/api/jobs`), event);
  expect(response.headers.get("x-middleware-rewrite")).toBe("https://example.invalid/api/jobs");
  expect(fetch).toHaveBeenCalledWith(new URL(`http://127.0.0.1:3000/api/auth/retained/validate?context=${id}`), expect.objectContaining({ redirect: "error" }));
});

it("still blocks writes in read-only impersonation before any handler", async () => {
  tokenState.role = "ADMIN";
  tokenState.readOnly = true;
  const response = await middleware(request("/api/admin/jobs/job", "PATCH"), event);
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("IMPERSONATION_READ_ONLY");
  expect(fetch).not.toHaveBeenCalled();
});
