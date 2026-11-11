// @vitest-environment node
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Mirrors NextAuth: its middleware returns nothing for its own /api/auth base path.
vi.mock("next-auth/middleware", () => ({
  withAuth: (handler: any) => async (req: any) => {
    if (req.nextUrl.pathname.startsWith("/api/auth")) return undefined;
    req.nextauth = { token: null };
    return handler(req);
  },
}));
vi.mock("@/lib/auth/impersonation", () => ({
  IMPERSONATION_COOKIE: "sneek.test-as",
  readImpersonationTicket: async () => null,
  isReadOnlySafeMethod: (method: string) => method === "GET",
}));
import middleware from "@/middleware";

const event = {} as any;

it.each(["/api/auth/2fa/settings", "/api/auth/webauthn/credentials"])(
  "forwards trusted path metadata to self-service route %s",
  async (path) => {
    const request = new NextRequest(`https://example.invalid${path}?x=1`, { method: "GET" });
    const response = await middleware(request, event);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-sneek-request-path")).toBe(`${path}?x=1`);
    expect(response.headers.get("x-middleware-request-x-sneek-request-method")).toBe("GET");
  },
);

it("overwrites client-supplied path metadata on NextAuth base-path routes", async () => {
  const request = new NextRequest("https://example.invalid/api/auth/2fa/settings", {
    method: "POST",
    headers: { "x-sneek-request-path": "/v2/admin/profile", "x-sneek-request-method": "GET" },
  });
  const response = await middleware(request, event);
  expect(response.headers.get("x-middleware-request-x-sneek-request-path")).toBe("/api/auth/2fa/settings");
  expect(response.headers.get("x-middleware-request-x-sneek-request-method")).toBe("POST");
});
