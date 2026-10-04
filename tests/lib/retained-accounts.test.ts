// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ authorize: vi.fn(), users: new Map<string, any>(), rows: new Map<string, any>(), audits: [] as any[] }));
vi.mock("@/lib/auth/auth-options", () => ({ createAuthOptions: () => ({ providers: [{ id: "credentials", options: { authorize: m.authorize } }] }) }));
vi.mock("@/lib/db", () => {
  const tx: any = { $queryRaw: async () => [], user: { findUnique: async ({ where }: any) => m.users.get(where.id) ?? null },
    appSetting: { findUnique: async ({ where }: any) => m.rows.get(where.key) ?? null,
      create: async ({ data }: any) => { if (m.rows.has(data.key)) throw new Error("duplicate"); m.rows.set(data.key, structuredClone(data)); return data; },
      update: async ({ where, data }: any) => { m.rows.set(where.key, { ...m.rows.get(where.key), ...structuredClone(data) }); } },
    auditLog: { create: async ({ data }: any) => m.audits.push(data) } };
  tx.$transaction = async (run: any) => { const snapshot = new Map(m.rows); const count = m.audits.length; try { return await run(tx); } catch (error) { m.rows = snapshot; m.audits.length = count; throw error; } };
  return { db: tx };
});
import { authenticateRetainedIdentity as auth, completeRetainedEnrollment, linkRetainedAccounts as link, listRetainedAccountsForBrowser, prepareRetainedIdentity, resolveRetainedAccount as resolve, revokeRetainedAccount as revoke } from "@/lib/auth/retained-accounts";
const creds = (email: string) => ({ email, password: "fixture-password" });
async function pair() { return link(await auth(creds("admin"), "mfa=admin-proof"), await auth(creds("cleaner"), "mfa=cleaner-proof"), true); }
const secrets = (pair: Awaited<ReturnType<typeof link>>, index: number) => ({ browserSecret: pair.browserSecret, ...pair.accounts[index] });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-04T04:00:00Z")); vi.stubEnv("NEXTAUTH_SECRET", "isolated-test-secret-not-production");
  m.rows.clear(); m.users.clear(); m.audits.length = 0; m.authorize.mockReset().mockImplementation(async ({ email }: any) => ({ id: email }));
  for (const [id, role] of [["admin", "ADMIN"], ["cleaner", "CLEANER"]]) m.users.set(id, { id, role, name: id, email: `${id}@example.invalid`, passwordHash: "fixture-hash", twoFactorEnabled: true, twoFactorMethod: "TOTP", totpSecret: "fixture-totp", isActive: true, extraRoles: [] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("retained account authority", () => {
  it("authenticates each identity through the existing MFA gate and rejects missing proof", async () => {
    m.authorize.mockResolvedValueOnce(null);
    await expect(auth(creds("admin"), "")).rejects.toThrow("UNAUTHORIZED");
    await auth(creds("cleaner"), "mfa=cleaner-proof");
    expect(m.authorize).toHaveBeenLastCalledWith(creds("cleaner"), { headers: { cookie: "mfa=cleaner-proof" } });
    expect(m.rows.size).toBe(0);
  });
  it("requires actual proofs, separate Admin/Cleaner identities and explicit consent", async () => {
    const a = await auth(creds("admin"), ""), c = await auth(creds("cleaner"), "");
    await expect(link(a, c, false)).rejects.toThrow("CONSENT_REQUIRED");
    await expect(link({ ...a }, c, true)).rejects.toThrow("UNAUTHORIZED");
    await expect(link(a, a, true)).rejects.toThrow("ACCOUNT_PAIR_REQUIRED");
    m.users.get("cleaner").role = "ADMIN";
    await expect(link(a, await auth(creds("cleaner"), ""), true)).rejects.toThrow("ACCOUNT_PAIR_REQUIRED");
    expect(m.rows.size).toBe(0);
  });
  it("stores only secret hashes and an audit while preserving independent identity and fixed expiry", async () => {
    const p = await pair();
    expect((await resolve(secrets(p, 0))).user.id).toBe("admin");
    expect((await resolve(secrets(p, 1))).user.id).toBe("cleaner");
    const stored = JSON.stringify([...m.rows.values(), ...m.audits]);
    for (const value of [p.browserSecret, ...p.accounts.map(a => a.contextSecret), "fixture-password", "fixture-hash", "fixture-totp"]) expect(stored).not.toContain(value);
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect((await resolve(secrets(p, 1))).expires).toBe(p.expiresAt);
    expect(m.audits[0].action).toBe("RETAINED_ACCOUNTS_LINKED");
  });
  it("rejects wrong selectors, mixed account secrets, mixed browser pairs and forged IDs", async () => {
    const p = await pair(), q = await pair();
    for (const invalid of [{ ...secrets(p, 0), contextId: p.accounts[1].contextId }, { ...secrets(p, 0), browserSecret: q.browserSecret }, { ...secrets(p, 0), contextSecret: "0".repeat(64) }, { ...secrets(p, 0), contextId: "admin" }]) await expect(resolve(invalid)).rejects.toThrow("UNAUTHORIZED");
  });
  it.each(["passwordHash", "role", "isActive", "totpSecret", "extraRoles"])("invalidates changed authority immediately (%s)", async field => {
    const p = await pair();
    m.users.get("cleaner")[field] = field === "isActive" ? false : field === "extraRoles" ? [{ role: "ADMIN" }] : "changed";
    await expect(resolve(secrets(p, 1))).rejects.toThrow("UNAUTHORIZED");
  });
  it("invalidates the pair when its owner is disabled; expires without silently refreshing", async () => {
    const p = await pair();
    m.users.get("admin").isActive = false;
    await expect(resolve(secrets(p, 1))).rejects.toThrow("UNAUTHORIZED");
    m.users.get("admin").isActive = true;
    vi.advanceTimersByTime(8 * 60 * 60 * 1000);
    await expect(resolve(secrets(p, 1))).rejects.toThrow("UNAUTHORIZED");
  });
  it("supports account-only and all-account revocation, retaining audit/history", async () => {
    const p = await pair(); await revoke(secrets(p, 1));
    await expect(resolve(secrets(p, 1))).rejects.toThrow("UNAUTHORIZED");
    expect((await resolve(secrets(p, 0))).user.id).toBe("admin");
    await revoke(secrets(p, 0), true);
    await expect(resolve(secrets(p, 0))).rejects.toThrow("UNAUTHORIZED");
    expect(m.audits.map(a => a.action)).toEqual(["RETAINED_ACCOUNTS_LINKED", "RETAINED_ACCOUNT_REVOKED", "RETAINED_ACCOUNTS_REVOKED"]);
    expect(m.rows.size).toBe(1);
  });
  it("rejects stale and replayed authentication proofs", async () => {
    const a = await auth(creds("admin"), ""), c = await auth(creds("cleaner"), "");
    await link(a, c, true);
    await expect(link(a, c, true)).rejects.toThrow("UNAUTHORIZED");
    const freshA = await auth(creds("admin"), ""), freshC = await auth(creds("cleaner"), "");
    vi.advanceTimersByTime(11 * 60 * 1000);
    await expect(link(freshA, freshC, true)).rejects.toThrow("AUTHENTICATION_EXPIRED");
  });
  it("binds encrypted enrollment proofs to the initiator and consumes them once transactionally", async () => {
    const a = await prepareRetainedIdentity(creds("admin"), "", "admin");
    const c = await prepareRetainedIdentity(creds("cleaner"), "", "admin");
    await expect(completeRetainedEnrollment(a, c, "cleaner", true)).rejects.toThrow("UNAUTHORIZED");
    const p = await completeRetainedEnrollment(a, c, "admin", true);
    expect((await resolve(secrets(p, 1))).user.id).toBe("cleaner");
    await expect(completeRetainedEnrollment(a, c, "admin", true)).rejects.toThrow("duplicate");
    expect(m.audits).toHaveLength(1);
  });
  it("does not list linked identities from a public selector or browser token alone", async () => {
    const p = await pair();
    expect(await listRetainedAccountsForBrowser(p.browserSecret, () => "")).toEqual([]);
    expect(await listRetainedAccountsForBrowser(p.browserSecret, id => p.accounts.find(a => a.contextId === id)?.contextSecret ?? "")).toHaveLength(2);
  });
});
