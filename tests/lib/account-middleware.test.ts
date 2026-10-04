// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("next-auth/middleware", () => ({ withAuth: (handler: any) => async (req: any) => { req.nextauth = { token: null }; return handler(req); } }));
vi.mock("@/lib/auth/impersonation", () => ({ IMPERSONATION_COOKIE: "sneek.test-as", readImpersonationTicket: async () => null, isReadOnlySafeMethod: (method: string) => method === "GET" }));
import middleware from "@/middleware";
const id = "a".repeat(32);
const request = (path: string, headers: Record<string, string> = {}, method = "GET") => new NextRequest(`https://example.invalid${path}`, { headers, method });
const event = {} as any;
it.each(["/sw.js", "/workbox-abc123.js", "/worker-abc123.js"])("serves worker infrastructure without a scoped redirect: %s", async path => {
 const response = await middleware(request(path, { referer: `https://example.invalid/_accounts/${id}/v2/cleaner` }), event);
 expect(response.headers.get("location")).toBeNull();
 expect(response.headers.get("x-middleware-next")).toBe("1");
});
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ valid: true, id: "cleaner", role: "CLEANER", heldRoles: ["CLEANER"], defaultPortalVersion: "v2" }), { status: 200 }))));
afterEach(() => vi.unstubAllGlobals());
it("strips spoofed context from unscoped requests before forwarding", async () => {
 const result = await middleware(request("/api/jobs", { "x-sneek-retained-context": id }), event);
 expect(result.headers.get("x-middleware-request-x-sneek-retained-context")).toBeNull();
 expect(result.headers.get("x-middleware-override-headers") ?? "").not.toContain("x-sneek-retained-context");
});
it("never falls back to a root admin cookie on a missed scoped API request", async () => {
 const result = await middleware(request("/api/admin/users", { referer: `https://example.invalid/_accounts/${id}/v2/cleaner`, cookie: "next-auth.session-token=admin" }, "POST"), event);
 expect(result.status).toBe(409);
 expect(fetch).not.toHaveBeenCalled();
});
it("validates the chosen identity and rewrites with isolated cookies and trusted context", async () => {
 const result = await middleware(request(`/_accounts/${id}/api/jobs/job/form`, { cookie: "next-auth.session-token=admin; sneek.test-as=impersonation; sneek.active-role=ADMIN; sneek.retained-browser=browser" }), event);
 expect(result.headers.get("x-middleware-rewrite")).toBe("https://example.invalid/api/jobs/job/form");
 expect(result.headers.get("x-middleware-request-x-sneek-retained-context")).toBe(id);
 const jar = result.headers.get("x-middleware-request-cookie")!;
 expect(jar).not.toContain("=admin"); expect(jar).not.toContain("sneek.test-as"); expect(jar).not.toContain("sneek.active-role");
 expect(jar).toContain(`sneek.retained-jwt.${id}=retained-context`);
 expect(result.headers.get("cache-control")).toBe("private, no-store");
});
it("enforces the selected cleaner role on admin navigation", async () => {
 const result = await middleware(request(`/_accounts/${id}/v2/admin`), event);
 expect(result.headers.get("location")).toBe(`https://example.invalid/_accounts/${id}/unauthorized`);
});
it.each([false, "failure"])("expires or fails closed without a shared-cookie fallback (%s)", async failure => {
 (fetch as any).mockImplementation(async () => { if (failure) throw new Error("unavailable"); return new Response("{}", { status: 401 }); });
 expect((await middleware(request(`/_accounts/${id}/api/uploads/direct`, { cookie: "next-auth.session-token=admin" }, "POST"), event)).status).toBe(401);
});
it.each(["/api/me/active-role", "/api/admin/impersonate", "/api/auth/callback/credentials"])("blocks shared-session mutation from a scoped tab: %s", async path => {
 expect((await middleware(request(`/_accounts/${id}${path}`, {}, "POST"), event)).status).toBe(403);
 expect(fetch).not.toHaveBeenCalled();
});
it("keeps ordinary links scoped but allows the explicit account manager", async () => {
 const headers = { referer: `https://example.invalid/_accounts/${id}/v2/cleaner` };
 expect((await middleware(request("/v2/cleaner/jobs/job", headers), event)).headers.get("location")).toBe(`https://example.invalid/_accounts/${id}/v2/cleaner/jobs/job`);
 expect((await middleware(request("/accounts", headers), event)).headers.get("x-middleware-next")).toBe("1");
});

it("uses the browser origin behind a proxy for missing-context protection and redirects", async () => {
 const req = new NextRequest("http://0.0.0.0:3000/api/admin/users", { method: "POST", headers: { host: "app.example.invalid", "x-forwarded-proto": "https", referer: `https://app.example.invalid/_accounts/${id}/v2/cleaner` } });
 expect((await middleware(req, event)).status).toBe(409);
 const page = new NextRequest(`http://0.0.0.0:3000/_accounts/${id}/v2/admin`, { headers: { host: "app.example.invalid", "x-forwarded-proto": "https" } });
 expect((await middleware(page, event)).headers.get("location")).toBe(`https://app.example.invalid/_accounts/${id}/unauthorized`);
});
