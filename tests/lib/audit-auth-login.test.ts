// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), upsert: vi.fn(), compare: vi.fn(), trust: vi.fn(), proof: vi.fn(), failed: vi.fn(), clear: vi.fn() }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
vi.mock("next-auth/providers/credentials", () => ({ default: (options: any) => options }));
vi.mock("bcryptjs", () => ({ default: { compare: m.compare, hash: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: m.user, upsert: m.upsert } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ websiteContent: { maintenanceMode: {} } }) }));
vi.mock("@/lib/auth/webauthn", () => ({ AUTHENTICATE_CHALLENGE_COOKIE: "challenge" }));
vi.mock("@/lib/auth/twofactor", () => ({ TRUSTED_DEVICE_COOKIE: "trusted", TWO_FA_OK_COOKIE: "proof", isTrustedDevice: m.trust, verifyTwoFaOk: m.proof, readCookieFromHeader: () => undefined }));
vi.mock("@/lib/auth/login-lockout", () => ({ loginKey: (email: string) => email, ensureNotLockedOut: async () => ({ ok: true }), recordFailedAttempt: m.failed, clearFailedAttempts: m.clear }));
import { createAuthOptions } from "@/lib/auth/auth-options";
const login = () => (createAuthOptions().providers[0] as any).authorize({ email: "test@example.invalid", password: "bootstrap-test-only" }, { headers: {} });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BOOTSTRAP_ADMIN_EMAIL", "test@example.invalid");
  vi.stubEnv("BOOTSTRAP_ADMIN_PASSWORD", "bootstrap-test-only");
  m.user.mockResolvedValue({ id: "admin", email: "test@example.invalid", role: "ADMIN", isActive: true, passwordHash: "hash", twoFactorEnabled: true });
  m.compare.mockResolvedValue(true); m.trust.mockResolvedValue(false); m.proof.mockReturnValue(false);
});
afterEach(() => vi.unstubAllEnvs());
it("bootstrap environment credentials cannot bypass enabled 2FA or mutate identity", async () => {
  expect(await login()).toBeNull(); expect(m.trust).toHaveBeenCalledWith("admin", undefined); expect(m.upsert).not.toHaveBeenCalled();
});
it("bootstrap credentials cannot reactivate a disabled user", async () => {
  m.user.mockResolvedValue({ id: "disabled", isActive: false, passwordHash: "hash" });
  expect(await login()).toBeNull(); expect(m.upsert).not.toHaveBeenCalled(); expect(m.compare).not.toHaveBeenCalled();
});
it("bootstrap credentials cannot create a missing user during login", async () => {
  m.user.mockResolvedValue(null); expect(await login()).toBeNull(); expect(m.upsert).not.toHaveBeenCalled();
});
it("requires the stored password, rather than accepting the bootstrap secret", async () => {
  m.compare.mockResolvedValue(false); expect(await login()).toBeNull(); expect(m.failed).toHaveBeenCalled(); expect(m.upsert).not.toHaveBeenCalled();
});
it.each(["proof", "trusted"])("accepts valid stored password and %s without identity updates", async mode => {
  if (mode === "proof") m.proof.mockReturnValue(true); else m.trust.mockResolvedValue(true);
  expect(await login()).toMatchObject({ id: "admin", role: "ADMIN" }); expect(m.upsert).not.toHaveBeenCalled();
});
