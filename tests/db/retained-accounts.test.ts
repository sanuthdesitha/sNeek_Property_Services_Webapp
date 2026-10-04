// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { decode } from "next-auth/jwt";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/auth/auth-options", () => ({ createAuthOptions: () => ({ providers: [{ id: "credentials", options: { authorize: async ({ email }: any) => ({ id: email }) } }] }) }));
import { authenticateRetainedIdentity as auth, linkRetainedAccounts as link, prepareRetainedIdentity, completeRetainedEnrollment, resolveRetainedAccount as resolve, revokeRetainedAccount as revoke } from "@/lib/auth/retained-accounts";
const url = process.env.SNEEK_TEST_DATABASE_URL;
let owner: string, cleaner: string; let keys: string[];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const credential = (email: string) => ({ email, password: "fixture-only" });
async function pair() { const value = await link(await auth(credential(owner), ""), await auth(credential(cleaner), ""), true); keys.push("retained_account_link_v1:" + hash(value.browserSecret)); return value; }
describe.skipIf(!url)("retained accounts with real transactional storage", () => {
 beforeAll(async () => { if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture DB required"); m.client = new PrismaClient({ datasources: { db: { url } } }); await m.client.$connect(); });
 beforeEach(async () => { owner = `qa-retained-owner-${randomUUID()}`; cleaner = `qa-retained-cleaner-${randomUUID()}`; keys = [];
  await m.client.user.createMany({ data: [{ id: owner, email: `${owner}@example.invalid`, role: "ADMIN", passwordHash: "fixture-only" }, { id: cleaner, email: `${cleaner}@example.invalid`, role: "CLEANER", passwordHash: "fixture-only" }] }); });
 afterEach(async () => { await m.client.appSetting.deleteMany({ where: { key: { in: keys } } }); await m.client.auditLog.deleteMany({ where: { userId: { in: [owner, cleaner] } } }); await m.client.user.deleteMany({ where: { id: { in: [owner, cleaner] } } }); });
 afterAll(async () => { await m.client?.$disconnect(); });
 it("retains two independent sessions and revokes only the requested identity", async () => {
  const p = await pair(); const a = { browserSecret: p.browserSecret, ...p.accounts[0] }, c = { browserSecret: p.browserSecret, ...p.accounts[1] };
  expect((await resolve(a)).user.id).toBe(owner); expect((await resolve(c)).user.id).toBe(cleaner);
  await revoke(c); await expect(resolve(c)).rejects.toThrow("UNAUTHORIZED"); expect((await resolve(a)).user.id).toBe(owner);
  expect(await m.client.auditLog.count({ where: { userId: { in: [owner, cleaner] } } })).toBe(2);
 });
 it("rejects changed credentials on the next request", async () => {
  const p = await pair(); await m.client.user.update({ where: { id: cleaner }, data: { passwordHash: "changed" } });
  await expect(resolve({ browserSecret: p.browserSecret, ...p.accounts[1] })).rejects.toThrow("UNAUTHORIZED");
 });
 it("consumes enrollment tickets once across concurrent requests without partial grants", async () => {
  const a = await prepareRetainedIdentity(credential(owner), "", owner), c = await prepareRetainedIdentity(credential(cleaner), "", owner);
  for (const token of [a, c]) { const data = await decode({ token, secret: process.env.NEXTAUTH_SECRET! }); keys.push("retained_account_proof_used:" + data!.enrollmentNonce); }
  const results = await Promise.allSettled([completeRetainedEnrollment(a, c, owner, true), completeRetainedEnrollment(a, c, owner, true)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  for (const result of results) if (result.status === "fulfilled") keys.push("retained_account_link_v1:" + hash(result.value.browserSecret));
  expect(await m.client.auditLog.count({ where: { userId: owner, action: "RETAINED_ACCOUNTS_LINKED" } })).toBe(1);
 });
});
