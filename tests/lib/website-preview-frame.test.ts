import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";
vi.mock("next-auth/middleware", () => ({ withAuth: (handler: any) => async (req: any) => { req.nextauth = { token: { id: "admin", role: "ADMIN" } }; return handler(req); } }));
vi.mock("@/lib/auth/impersonation", () => ({ IMPERSONATION_COOKIE: "sneek.test-as", readImpersonationTicket: async () => null, isReadOnlySafeMethod: (method: string) => method === "GET" }));
import middleware from "@/middleware";

beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ valid: true, id: "admin", role: "ADMIN", heldRoles: ["ADMIN"], opsAccess: allOpsLevels("manage") }), { status: 200 }))));
afterEach(() => vi.unstubAllGlobals());

const request = (path: string) => new NextRequest(`https://example.invalid${path}`);

it("only the website preview may be framed, and only by this origin (the editor's preview pane)", async () => {
  const preview = await middleware(request("/v2/admin/website/preview"), {} as any);
  expect(preview?.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  expect(preview?.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
  for (const path of ["/v2/admin/website", "/v2/admin/marketing", "/v2/admin/jobs", "/api/admin/settings"]) {
    const response = await middleware(request(path), {} as any);
    const frameHeader = response?.headers.get("X-Frame-Options");
    if (frameHeader) expect(frameHeader, path).toBe("DENY");
    const csp = response?.headers.get("Content-Security-Policy");
    if (csp) expect(csp, path).toContain("frame-ancestors 'none'");
  }
});
