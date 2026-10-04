// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ session: vi.fn(), prepare: vi.fn(), complete: vi.fn(), list: vi.fn(), revoke: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRealSession: m.session }));
vi.mock("@/lib/auth/retained-accounts", () => ({ prepareRetainedIdentity: m.prepare, completeRetainedEnrollment: m.complete, listRetainedAccounts: m.list, listRetainedAccountsForBrowser: m.list, revokeRetainedAccount: m.revoke }));
vi.mock("@/lib/auth/retained-context", () => ({ RETAINED_BROWSER_COOKIE: "sneek.retained-browser", retainedSecretCookie: (id: string) => `sneek.retained-secret.${id}` }));
import { POST } from "@/app/api/auth/retained/route";
const req = (body: any, origin = "https://example.invalid") => new NextRequest("https://example.invalid/api/auth/retained", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } }); m.list.mockResolvedValue([]); m.prepare.mockResolvedValue("encrypted-proof"); m.complete.mockResolvedValue({ browserSecret: "browser-secret", accounts: [{ contextId: "a".repeat(32), contextSecret: "member-secret" }] }); });
it("requires same-origin explicit consent before any persistent link", async () => {
 expect((await POST(req({ action: "link", consent: true }, "https://attacker.invalid"))).status).toBe(403);
 expect((await POST(req({ action: "link", consent: false }))).status).toBe(400);
 expect(m.complete).not.toHaveBeenCalled();
});
it("returns no credentials or secrets in JSON and sets HttpOnly cookies only after consent", async () => {
 const response = await POST(req({ action: "link", consent: true }));
 expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
 const header = response.headers.get("set-cookie")!;
 expect(header).toContain("HttpOnly"); expect(header).toContain("SameSite=strict");
 expect(header).not.toContain("next-auth.session-token");
});
it("cannot silently replace active retained sessions in other tabs", async () => {
 m.list.mockResolvedValue([{ available: true }]);
 expect((await POST(req({ action: "link", consent: true }))).status).toBe(409); expect(m.complete).not.toHaveBeenCalled();
});
it("does not accept a forged user ID instead of credentials", async () => {
 expect((await POST(req({ action: "prepare", slot: "other", credentials: { userId: "admin" } }))).status).toBe(401);
 expect(m.prepare).not.toHaveBeenCalled();
});
