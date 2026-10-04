// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
const m = vi.hoisted(() => ({ context: null as string | null, session: vi.fn() }));
vi.mock("@/lib/auth/retained-context", () => ({ retainedContextId: () => m.context, retainedRequestSession: m.session }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
import { createAuthOptions } from "@/lib/auth/auth-options";
const secret = "test-signing-secret-no-live-identity";
beforeEach(() => { m.context = null; m.session.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
it("preserves ordinary authentication but rejects a retained cookie outside its context", async () => {
 const decode = createAuthOptions().jwt!.decode!;
 const normal = await encode({ secret, token: { id: "admin", role: "ADMIN" } });
 expect(await decode({ secret, token: normal })).toMatchObject({ id: "admin" });
 const retained = await encode({ secret, token: { id: "cleaner", role: "CLEANER", retainedContext: "a".repeat(32) } });
 expect(await decode({ secret, token: retained })).toBeNull();
});
it("uses fresh server authority rather than the shared admin cookie and fails closed on revocation", async () => {
 m.context = "a".repeat(32);
 m.session.mockResolvedValue({ user: { id: "cleaner", role: "CLEANER", name: "Cleaner" }, expires: "2026-10-04T12:00:00Z" });
 const options = createAuthOptions("https://example.invalid");
 expect(options.cookies?.sessionToken?.name).toBe(`__Secure-sneek.retained-jwt.${m.context}`);
 expect(options.cookies?.csrfToken?.name).toBe(`sneek.retained-csrf.${m.context}`);
 expect(await options.jwt!.decode!({ secret, token: "retained-context" })).toMatchObject({ id: "cleaner", role: "CLEANER", retainedContext: m.context });
 m.session.mockRejectedValue(new Error("revoked"));
 expect(await options.jwt!.decode!({ secret, token: "retained-context" })).toBeNull();
});
