// @vitest-environment node
/**
 * The Xero token lifecycle (lib/xero/token-service.ts, keepalive.ts,
 * connection-status.ts). Mocked fetch and an in-memory connection table; no
 * Xero credentials exist here, so nothing talks to Xero.
 *
 * The first block is written against the public client functions and ran,
 * and failed, against the code before the fix (two token exchanges for two
 * concurrent calls; a 503 renewal treated as a lapse; a 401 never retried).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeXeroConnectionTable, type FakeXeroRow } from "./support/fake-xero-connection";

const m = vi.hoisted(() => ({
  table: null as unknown as ReturnType<typeof import("./support/fake-xero-connection").createFakeXeroConnectionTable>,
  fetch: vi.fn(),
  notice: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: m.log }));
vi.mock("@/lib/db", () => ({
  db: {
    get xeroConnection() { return m.table.table; },
    appSetting: { findUnique: async () => ({ value: { xeroClientId: "client-id", xeroClientSecret: "client-secret" } }) },
  },
}));
vi.mock("@/lib/xero/reconnect-notice", () => ({ sendXeroReconnectNotice: m.notice }));
import { pushClientInvoiceToXero, readXeroInvoices } from "@/lib/xero/client";
import { getXeroAccessToken, REFRESH_MARGIN_MS, type XeroTokenDeps } from "@/lib/xero/token-service";
import { runXeroKeepAlive } from "@/lib/xero/keepalive";
import { buildXeroStatus } from "@/lib/xero/connection-status";
import { decryptSecret, isEncrypted } from "@/lib/security/encryption";

const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const ok = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
const fail = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => ({ ok: false, status, headers: new Headers(headers), json: async () => body, text: async () => JSON.stringify(body) });
const invoice = (id: string) => ({ InvoiceID: id, Status: "AUTHORISED", Total: 10, AmountDue: 10, AmountPaid: 0 });

const NOW = new Date("2026-11-15T01:00:00Z");

function connection(overrides: Partial<FakeXeroRow> = {}): FakeXeroRow {
  return {
    id: "conn-1", tenantId: "tenant-1", tenantName: "Fixture Org", isActive: true, scopes: [],
    accessToken: "access-old", refreshToken: "refresh-old", expiresAt: new Date(Date.now() + 60_000),
    tokenVersion: 0, status: "CONNECTED", statusReason: null, statusReasonCode: null, needsReconnectAt: null,
    reconnectNoticeAt: null, refreshLockId: null, refreshLockUntil: null, lastRefreshedAt: null,
    lastRefreshError: null, lastRefreshAttemptAt: null, connectedAt: new Date("2026-11-01T00:00:00Z"),
    createdAt: new Date("2026-11-01T00:00:00Z"), lastSyncAt: null, lastSyncError: null,
    ...overrides,
  };
}

let exchanges = 0;
function tokenEndpoint(handler?: (refreshToken: string) => unknown) {
  m.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    if (url === TOKEN_URL) {
      exchanges += 1;
      const refreshToken = new URLSearchParams(String(init.body)).get("refresh_token") ?? "";
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (handler) return handler(refreshToken);
      return ok({ access_token: `access-${exchanges}`, refresh_token: `refresh-${exchanges}`, expires_in: 1800 });
    }
    if (url === CONNECTIONS_URL) return ok([{ tenantId: "tenant-1", tenantName: "Fixture Org" }]);
    return ok({ Invoices: [invoice("a")] });
  });
}

/** Injected deps for the token service: the fake table, mocked fetch, a fixed clock, no real waits. */
function deps(overrides: Partial<XeroTokenDeps> = {}): Partial<XeroTokenDeps> {
  return {
    db: { xeroConnection: m.table.table } as unknown as XeroTokenDeps["db"],
    fetch: m.fetch as unknown as typeof fetch,
    now: () => NOW,
    sleep: vi.fn(async () => undefined),
    credentials: async () => ({ clientId: "client-id", clientSecret: "client-secret" }),
    notify: m.notice,
    ...overrides,
  };
}

const row = () => m.table.rows[0];

beforeEach(() => {
  vi.resetAllMocks();
  process.env.ENCRYPTION_KEY = "fixture-encryption-key";
  exchanges = 0;
  vi.stubGlobal("fetch", m.fetch);
  m.notice.mockResolvedValue(undefined);
  m.table = createFakeXeroConnectionTable([connection()]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ENCRYPTION_KEY;
});

describe("the 30-minute lapse (regression, public functions)", () => {
  it("two concurrent calls near expiry make one token exchange and keep the rotated refresh token", async () => {
    tokenEndpoint();
    const [first, second] = await Promise.all([readXeroInvoices(["a"]), readXeroInvoices(["a"])]);
    expect(first.get("a")?.ok).toBe(true);
    expect(second.get("a")?.ok).toBe(true);
    expect(exchanges).toBe(1);
    expect(decryptSecret(String(row().refreshToken))).toBe("refresh-1");
  });

  it("a 401 from the API refreshes once and retries the request once, with the same Idempotency-Key", async () => {
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(Date.now() + 3_600_000) })]);
    let apiCalls = 0;
    m.fetch.mockImplementation(async (url: string) => {
      if (url === TOKEN_URL) {
        exchanges += 1;
        return ok({ access_token: "access-new", refresh_token: "refresh-new", expires_in: 1800 });
      }
      apiCalls += 1;
      return apiCalls === 1 ? fail(401, { Title: "Unauthorized" }) : ok({ Invoices: [{ InvoiceID: "remote-1" }] });
    });
    const result = await pushClientInvoiceToXero({ idempotencyKey: "key-1", invoiceNumber: "INV-1", clientName: "Client", clientEmail: "c@example.invalid", clientXeroContactId: "contact", lineItems: [{ description: "Work", quantity: 1, unitAmount: 10 }] });
    expect(result.xeroInvoiceId).toBe("remote-1");
    expect(exchanges).toBe(1);
    expect(apiCalls).toBe(2);
    const retried = m.fetch.mock.calls.filter(([url]) => url !== TOKEN_URL)[1][1] as RequestInit & { headers: Record<string, string> };
    expect(retried.headers.Authorization).toBe("Bearer access-new");
    expect(retried.headers["Idempotency-Key"]).toBe("key-1");
  });

  it("a second 401 after renewal is not retried again; a removed organisation becomes needs reconnect", async () => {
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(Date.now() + 3_600_000) })]);
    m.fetch.mockImplementation(async (url: string) => {
      if (url === TOKEN_URL) {
        exchanges += 1;
        return ok({ access_token: "access-new", refresh_token: "refresh-new", expires_in: 1800 });
      }
      if (url === CONNECTIONS_URL) return ok([]);
      return fail(401, { Title: "Unauthorized" });
    });
    const reads = await readXeroInvoices(["a"]);
    expect(reads.get("a")).toMatchObject({ ok: false, failure: { kind: "not-connected", reason: expect.stringContaining("no longer connected") } });
    expect(exchanges).toBe(1);
    expect(m.fetch.mock.calls.filter(([url]) => String(url).includes("/api.xro/"))).toHaveLength(2);
    expect(row()).toMatchObject({ status: "NEEDS_RECONNECT", statusReasonCode: "TENANT_REMOVED" });
    expect(m.notice).toHaveBeenCalledTimes(1);
  });
});

describe("token service", () => {
  it("uses a fresh token without renewing", async () => {
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(NOW.getTime() + 20 * 60_000) })]);
    tokenEndpoint();
    const outcome = await getXeroAccessToken({}, deps());
    expect(outcome).toMatchObject({ ok: true, refreshed: false, token: { accessToken: "access-old" } });
    expect(exchanges).toBe(0);
  });

  it("renews within five minutes of expiry and stores the new tokens encrypted, versioned, before returning them", async () => {
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(NOW.getTime() + REFRESH_MARGIN_MS - 1000) })]);
    tokenEndpoint();
    const outcome = await getXeroAccessToken({}, deps());
    expect(outcome).toMatchObject({ ok: true, refreshed: true, token: { accessToken: "access-1", tokenVersion: 1 } });
    expect(isEncrypted(String(row().accessToken))).toBe(true);
    expect(isEncrypted(String(row().refreshToken))).toBe(true);
    expect(decryptSecret(String(row().accessToken))).toBe("access-1");
    expect(decryptSecret(String(row().refreshToken))).toBe("refresh-1");
    expect(row()).toMatchObject({ tokenVersion: 1, lastRefreshedAt: NOW, lastRefreshError: null, refreshLockId: null, status: "CONNECTED" });
    expect((row().expiresAt as Date).getTime()).toBe(NOW.getTime() + 1800_000);
  });

  it("never hands out a renewed token that could not be stored", async () => {
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(NOW.getTime() - 1000) })]);
    tokenEndpoint();
    const original = m.table.table.updateMany;
    m.table.table.updateMany = vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if ("tokenVersion" in args.data) throw new Error("database unavailable");
      return original(args);
    }) as typeof original;
    const outcome = await getXeroAccessToken({}, deps());
    expect(outcome).toMatchObject({ ok: false, kind: "transient" });
    expect(JSON.stringify(outcome)).not.toContain("access-1");
    expect(row()).toMatchObject({ refreshToken: "refresh-old", status: "CONNECTED", refreshLockId: null });
  });

  it("a transient failure (503) is retried with backoff and keeps the connection; a still-valid token keeps working", async () => {
    tokenEndpoint(() => fail(503, { error: "temporarily_unavailable" }));
    const sleep = vi.fn(async () => undefined);
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(NOW.getTime() + 60_000) })]);
    const outcome = await getXeroAccessToken({}, deps({ sleep }));
    expect(outcome).toMatchObject({ ok: true, refreshed: false, token: { accessToken: "access-old" } });
    expect(exchanges).toBe(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 4000]);
    expect(row()).toMatchObject({ status: "CONNECTED", refreshLockId: null, lastRefreshError: expect.stringContaining("503") });
    expect(buildXeroStatus(row() as never, NOW).state).toBe("attention");
    expect(m.notice).not.toHaveBeenCalled();
  });

  it("an expired token with a transient failure is reported as transient, never as connected", async () => {
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(NOW.getTime() - 1000) })]);
    m.fetch.mockRejectedValue(new Error("ECONNRESET"));
    const outcome = await getXeroAccessToken({}, deps());
    expect(outcome).toMatchObject({ ok: false, kind: "transient" });
    expect(row().status).toBe("CONNECTED");
  });

  it("waits out a 429 with Retry-After before renewing", async () => {
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(NOW.getTime() - 1000) })]);
    let calls = 0;
    tokenEndpoint(() => (++calls === 1 ? fail(429, {}, { "Retry-After": "2" }) : ok({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 1800 })));
    const sleep = vi.fn(async () => undefined);
    const outcome = await getXeroAccessToken({}, deps({ sleep }));
    expect(outcome).toMatchObject({ ok: true, token: { accessToken: "access-2" } });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("invalid_grant marks needs reconnect once: no retry storm and one notice", async () => {
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(NOW.getTime() - 1000) })]);
    tokenEndpoint(() => fail(400, { error: "invalid_grant" }));
    const first = await getXeroAccessToken({}, deps());
    expect(first).toMatchObject({ ok: false, kind: "needs-reconnect", code: "REFRESH_REJECTED" });
    for (let index = 0; index < 5; index += 1) {
      expect(await getXeroAccessToken({}, deps())).toMatchObject({ ok: false, kind: "needs-reconnect" });
    }
    expect(exchanges).toBe(1);
    expect(m.notice).toHaveBeenCalledTimes(1);
    expect(m.notice.mock.calls[0][0]).toMatchObject({ connectionId: "conn-1", tenantName: "Fixture Org", reason: expect.stringContaining("invalid_grant") });
    // Kept for audit: tokens are not wiped and the row stays.
    expect(row()).toMatchObject({ status: "NEEDS_RECONNECT", statusReasonCode: "REFRESH_REJECTED", refreshToken: "refresh-old", isActive: true, reconnectNoticeAt: NOW });
    expect(buildXeroStatus(row() as never, NOW)).toMatchObject({ connected: false, state: "needs-reconnect", signIn: "lapsed" });
  });

  it("the app's credentials refused (invalid_client) is terminal with its own reason", async () => {
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(NOW.getTime() - 1000) })]);
    tokenEndpoint(() => fail(400, { error: "invalid_client" }));
    expect(await getXeroAccessToken({}, deps())).toMatchObject({ ok: false, kind: "needs-reconnect", code: "APP_CREDENTIALS_REJECTED" });
    expect(row().statusReason).toContain("Client ID or Secret");
  });

  it("refuses to renew without ENCRYPTION_KEY, before calling Xero (a rotated token must never be lost)", async () => {
    delete process.env.ENCRYPTION_KEY;
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(NOW.getTime() - 1000) })]);
    tokenEndpoint();
    expect(await getXeroAccessToken({}, deps())).toMatchObject({ ok: false, kind: "configuration", reason: expect.stringContaining("ENCRYPTION_KEY") });
    expect(exchanges).toBe(0);
    expect(row()).toMatchObject({ status: "CONNECTED", refreshLockId: null });
  });

  it("while another process holds the renewal lease, a still-valid token is used and an expired one waits for the new version", async () => {
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(NOW.getTime() + 2 * 60_000), refreshLockId: "other", refreshLockUntil: new Date(NOW.getTime() + 60_000) })]);
    tokenEndpoint();
    expect(await getXeroAccessToken({}, deps())).toMatchObject({ ok: true, token: { accessToken: "access-old" } });

    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(NOW.getTime() - 1000), refreshLockId: "other", refreshLockUntil: new Date(NOW.getTime() + 60_000) })]);
    const sleep = vi.fn(async () => {
      // The other process finishes its renewal.
      Object.assign(m.table.rows[0], { accessToken: "access-other", tokenVersion: 1, expiresAt: new Date(NOW.getTime() + 1800_000), refreshLockId: null, refreshLockUntil: null });
    });
    expect(await getXeroAccessToken({}, deps({ sleep }))).toMatchObject({ ok: true, refreshed: false, token: { accessToken: "access-other", tokenVersion: 1 } });
    expect(exchanges).toBe(0);
  });
});

describe("a connection made without offline_access", () => {
  it("works until expiry, shows 'Reconnect Xero once to keep it connected', then needs reconnect without calling Xero", async () => {
    m.table = createFakeXeroConnectionTable([connection({ refreshToken: "", expiresAt: new Date(NOW.getTime() + 2 * 60_000) })]);
    tokenEndpoint();
    expect(await getXeroAccessToken({}, deps())).toMatchObject({ ok: true, token: { accessToken: "access-old" } });
    const status = buildXeroStatus(row() as never, NOW);
    expect(status).toMatchObject({ state: "reconnect-once", connected: true, hasRefreshToken: false, signIn: "no-refresh-token", nextRefreshAt: null });
    expect(status.reason).toContain("Reconnect Xero once to keep it connected");

    row().expiresAt = new Date(NOW.getTime() - 1000);
    expect(await getXeroAccessToken({}, deps())).toMatchObject({ ok: false, kind: "needs-reconnect", code: "NO_REFRESH_TOKEN" });
    expect(exchanges).toBe(0);
    expect(m.notice).toHaveBeenCalledTimes(1);
  });
});

describe("daily keep-alive", () => {
  it("renews an idle connection, records the renewal and checks the organisation", async () => {
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(NOW.getTime() + 25 * 60_000) })]);
    tokenEndpoint();
    expect(await runXeroKeepAlive(deps())).toEqual({ outcome: "renewed", tenantCheck: "present", renewedHere: true });
    expect(exchanges).toBe(1);
    expect(row()).toMatchObject({ lastRefreshedAt: NOW, tokenVersion: 1, lastTenantCheckAt: NOW });
    expect(buildXeroStatus(row() as never, NOW).renewBy).toBe(new Date(NOW.getTime() + 60 * 86_400_000).toISOString());
  });

  it("is a no-op without a connection", async () => {
    m.table = createFakeXeroConnectionTable([]);
    expect(await runXeroKeepAlive(deps())).toEqual({ outcome: "not-connected" });
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("detects an organisation removed in Xero", async () => {
    m.fetch.mockImplementation(async (url: string) => (url === TOKEN_URL ? ok({ access_token: "a", refresh_token: "r", expires_in: 1800 }) : ok([{ tenantId: "someone-else" }])));
    expect(await runXeroKeepAlive(deps())).toMatchObject({ outcome: "needs-reconnect" });
    expect(row()).toMatchObject({ status: "NEEDS_RECONNECT", statusReasonCode: "TENANT_REMOVED" });
  });

  it("does not call Xero for a connection that needs reconnecting, and retries a notice that failed to queue", async () => {
    m.table = createFakeXeroConnectionTable([connection({ status: "NEEDS_RECONNECT", statusReasonCode: "REFRESH_REJECTED", statusReason: "Refused.", needsReconnectAt: NOW })]);
    m.notice.mockRejectedValueOnce(new Error("pipeline down"));
    expect(await runXeroKeepAlive(deps())).toMatchObject({ outcome: "needs-reconnect", noticeQueued: false });
    expect(row().reconnectNoticeAt).toBeNull();
    expect(await runXeroKeepAlive(deps())).toMatchObject({ outcome: "needs-reconnect", noticeQueued: true });
    expect(await runXeroKeepAlive(deps())).toMatchObject({ outcome: "needs-reconnect", noticeQueued: false });
    expect(m.notice).toHaveBeenCalledTimes(2);
    expect(m.fetch).not.toHaveBeenCalled();
  });
});

describe("no token in logs", () => {
  it("logs no access or refresh token across success, transient and terminal renewals", async () => {
    m.table = createFakeXeroConnectionTable([connection({ expiresAt: new Date(NOW.getTime() - 1000), accessToken: "SECRET-ACCESS-0", refreshToken: "SECRET-REFRESH-0" })]);
    m.fetch.mockResolvedValueOnce(ok({ access_token: "SECRET-ACCESS-1", refresh_token: "SECRET-REFRESH-1", expires_in: 1800 }));
    await getXeroAccessToken({}, deps());
    row().expiresAt = new Date(NOW.getTime() - 1000);
    m.fetch.mockRejectedValueOnce(new Error("socket closed for Bearer SECRET-ACCESS-1"));
    m.fetch.mockRejectedValueOnce(new Error("socket closed"));
    m.fetch.mockRejectedValueOnce(new Error("socket closed"));
    await getXeroAccessToken({}, deps());
    m.fetch.mockResolvedValueOnce(fail(400, { error: "invalid_grant", error_description: "token SECRET-REFRESH-1 expired" }));
    await getXeroAccessToken({}, deps());
    const logged = JSON.stringify([m.log.info.mock.calls, m.log.warn.mock.calls, m.log.error.mock.calls, m.log.debug.mock.calls]);
    expect(logged.length).toBeGreaterThan(10);
    expect(logged).not.toMatch(/SECRET-(ACCESS|REFRESH)/);
    expect(String(row().lastRefreshError ?? "")).not.toMatch(/SECRET-ACCESS/);
  });
});
