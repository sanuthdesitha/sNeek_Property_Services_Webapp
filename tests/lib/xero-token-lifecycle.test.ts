// @vitest-environment node
/**
 * Why the Xero connection died about 30 minutes after connecting, written
 * against the public client functions (so it ran, and failed, against the code
 * before the fix): concurrent refreshes, a transient refresh failure treated
 * as a lapse, and a 401 that was never retried. Mocked fetch and an in-memory
 * connection table; no Xero credentials exist here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeXeroConnectionTable, type FakeXeroRow } from "./support/fake-xero-connection";

const m = vi.hoisted(() => ({
  table: null as unknown as ReturnType<typeof import("./support/fake-xero-connection").createFakeXeroConnectionTable>,
  fetch: vi.fn(),
  notice: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    get xeroConnection() { return m.table.table; },
    appSetting: { findUnique: async () => ({ value: { xeroClientId: "client-id", xeroClientSecret: "client-secret" } }) },
  },
}));
vi.mock("@/lib/xero/reconnect-notice", () => ({ sendXeroReconnectNotice: m.notice }));
import { pushClientInvoiceToXero, readXeroInvoices } from "@/lib/xero/client";

const TOKEN_URL = "https://identity.xero.com/connect/token";
const ok = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
const fail = (status: number, body: unknown = {}) => ({ ok: false, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
const invoice = (id: string) => ({ InvoiceID: id, Status: "AUTHORISED", Total: 10, AmountDue: 10, AmountPaid: 0 });

function connection(overrides: Partial<FakeXeroRow> = {}): FakeXeroRow {
  return {
    id: "conn-1", tenantId: "tenant-1", tenantName: "Fixture Org", isActive: true, scopes: [],
    accessToken: "access-old", refreshToken: "refresh-old", expiresAt: new Date(Date.now() + 60_000),
    tokenVersion: 0, status: "CONNECTED", statusReason: null, refreshLockId: null, refreshLockUntil: null,
    createdAt: new Date(), lastSyncAt: null, lastSyncError: null,
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
    return ok({ Invoices: [invoice("a")] });
  });
}

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

describe("the 30-minute lapse (regression)", () => {
  it("two concurrent calls near expiry make one token exchange and keep the rotated refresh token", async () => {
    tokenEndpoint();
    const [first, second] = await Promise.all([readXeroInvoices(["a"]), readXeroInvoices(["a"])]);
    expect(first.get("a")?.ok).toBe(true);
    expect(second.get("a")?.ok).toBe(true);
    expect(exchanges).toBe(1);
    expect(m.table.rows[0].refreshToken).not.toBe("refresh-old");
  });

  it("a transient refresh failure (503) with a still-valid access token keeps working and is not a lapse", async () => {
    tokenEndpoint(() => fail(503, { error: "temporarily_unavailable" }));
    const reads = await readXeroInvoices(["a"], { sleep: async () => undefined });
    expect(reads.get("a")?.ok).toBe(true);
    expect(m.table.rows[0].status).toBe("CONNECTED");
    expect(String(m.table.rows[0].lastSyncError ?? "")).not.toContain("SIGN_IN_LAPSED");
    expect(m.notice).not.toHaveBeenCalled();
  });

  it("a 401 from the API refreshes once and retries the request once", async () => {
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
});
