// @vitest-environment node
/**
 * Xero token renewal on a real, disposable PostgreSQL (127.0.0.1:55439) with
 * real concurrency: two Prisma clients stand for two processes (a web replica
 * and the worker). Xero itself is mocked (no credentials exist here).
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { getXeroAccessToken, type XeroTokenDeps } from "@/lib/xero/token-service";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const TOKEN_URL = "https://identity.xero.com/connect/token";
const tenantId = `fixture-xero-${randomUUID()}`;
let processA: PrismaClient;
let processB: PrismaClient;

type Exchange = { refreshToken: string };

function tokenEndpoint(exchanges: Exchange[], respond: (n: number) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== TOKEN_URL) throw new Error(`unexpected request ${String(input)}`);
    exchanges.push({ refreshToken: new URLSearchParams(String(init?.body)).get("refresh_token") ?? "" });
    await new Promise((resolve) => setTimeout(resolve, 150));
    return respond(exchanges.length);
  }) as unknown as typeof fetch;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function depsFor(client: PrismaClient, fetchImpl: typeof fetch, notify = vi.fn(async () => undefined)): Partial<XeroTokenDeps> {
  return {
    db: client,
    fetch: fetchImpl,
    credentials: async () => ({ clientId: "fixture-client", clientSecret: "fixture-secret" }),
    notify,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 50))),
  };
}

describe.skipIf(!url)("Xero token renewal (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    process.env.ENCRYPTION_KEY = "fixture-encryption-key";
    processA = new PrismaClient({ datasources: { db: { url } } });
    processB = new PrismaClient({ datasources: { db: { url } } });
    const others = await processA.xeroConnection.count({ where: { isActive: true, tenantId: { not: tenantId } } });
    if (others > 0) throw Error("The fixture database already has an active Xero connection; use a fresh database");
  });

  beforeEach(async () => {
    await processA.xeroConnection.deleteMany({ where: { tenantId } });
    await processA.xeroConnection.create({
      data: {
        tenantId, tenantName: "Fixture Org", scopes: ["offline_access"], isActive: true,
        accessToken: encryptSecret("access-0")!, refreshToken: encryptSecret("refresh-0")!,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
  });

  afterAll(async () => {
    if (!processA) return;
    await processA.xeroConnection.deleteMany({ where: { tenantId } });
    await processA.$disconnect();
    await processB.$disconnect();
    delete process.env.ENCRYPTION_KEY;
  });

  it("two processes renewing at once make exactly one token exchange and store the newest refresh token", async () => {
    const exchanges: Exchange[] = [];
    const fetchImpl = tokenEndpoint(exchanges, (n) => json(200, { access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 1800 }));
    const outcomes = await Promise.all([
      getXeroAccessToken({}, depsFor(processA, fetchImpl)),
      getXeroAccessToken({}, depsFor(processB, fetchImpl)),
      getXeroAccessToken({}, depsFor(processA, fetchImpl)),
      getXeroAccessToken({}, depsFor(processB, fetchImpl)),
    ]);
    expect(exchanges).toEqual([{ refreshToken: "refresh-0" }]);
    for (const outcome of outcomes) expect(outcome).toMatchObject({ ok: true, token: { accessToken: "access-1", tokenVersion: 1 } });
    const stored = await processA.xeroConnection.findUniqueOrThrow({ where: { tenantId } });
    expect(decryptSecret(stored.refreshToken)).toBe("refresh-1");
    expect(decryptSecret(stored.accessToken)).toBe("access-1");
    expect(stored).toMatchObject({ tokenVersion: 1, status: "CONNECTED", refreshLockId: null, refreshLockUntil: null });
    expect(stored.lastRefreshedAt).not.toBeNull();
  });

  it("a 401 seen by two processes at once renews once; the second uses the first's new version", async () => {
    await processA.xeroConnection.update({ where: { tenantId }, data: { expiresAt: new Date(Date.now() + 3_600_000) } });
    const exchanges: Exchange[] = [];
    const fetchImpl = tokenEndpoint(exchanges, (n) => json(200, { access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 1800 }));
    const outcomes = await Promise.all([
      getXeroAccessToken({ rejectedVersion: 0 }, depsFor(processA, fetchImpl)),
      getXeroAccessToken({ rejectedVersion: 0 }, depsFor(processB, fetchImpl)),
    ]);
    expect(exchanges).toHaveLength(1);
    for (const outcome of outcomes) expect(outcome).toMatchObject({ ok: true, token: { tokenVersion: 1, accessToken: "access-1" } });
  });

  it("invalid_grant seen concurrently marks needs reconnect once, with one notice and no retry storm", async () => {
    const exchanges: Exchange[] = [];
    const fetchImpl = tokenEndpoint(exchanges, () => json(400, { error: "invalid_grant" }));
    const notify = vi.fn(async () => undefined);
    const outcomes = await Promise.all([
      getXeroAccessToken({}, depsFor(processA, fetchImpl, notify)),
      getXeroAccessToken({}, depsFor(processB, fetchImpl, notify)),
      getXeroAccessToken({}, depsFor(processB, fetchImpl, notify)),
    ]);
    for (const outcome of outcomes) expect(outcome).toMatchObject({ ok: false, kind: "needs-reconnect" });
    await getXeroAccessToken({}, depsFor(processA, fetchImpl, notify));
    expect(exchanges).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
    const stored = await processA.xeroConnection.findUniqueOrThrow({ where: { tenantId } });
    expect(stored).toMatchObject({ status: "NEEDS_RECONNECT", statusReasonCode: "REFRESH_REJECTED", isActive: true });
    expect(stored.reconnectNoticeAt).not.toBeNull();
    expect(decryptSecret(stored.refreshToken)).toBe("refresh-0");
  });

  it("a transient failure releases the lease and leaves the connection CONNECTED with the reason", async () => {
    const exchanges: Exchange[] = [];
    const fetchImpl = tokenEndpoint(exchanges, () => json(503, { error: "temporarily_unavailable" }));
    const outcome = await getXeroAccessToken({}, depsFor(processA, fetchImpl));
    expect(outcome).toMatchObject({ ok: false, kind: "transient" });
    expect(exchanges).toHaveLength(3);
    const stored = await processA.xeroConnection.findUniqueOrThrow({ where: { tenantId } });
    expect(stored).toMatchObject({ status: "CONNECTED", refreshLockId: null, tokenVersion: 0 });
    expect(stored.lastRefreshError).toContain("503");
    expect(decryptSecret(stored.refreshToken)).toBe("refresh-0");
  });
});
