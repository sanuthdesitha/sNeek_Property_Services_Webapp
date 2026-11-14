// @vitest-environment node
/** Connecting Xero: tokens stored encrypted, a fresh CONNECTED status, version bumped, others deactivated; no ENCRYPTION_KEY → refused before Xero. Mocked fetch. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ fetch: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), transaction: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: m.transaction,
    xeroConnection: { upsert: m.upsert, updateMany: m.updateMany },
    appSetting: { findUnique: async () => ({ value: { xeroClientId: "client-id", xeroClientSecret: "client-secret" } }) },
  },
}));
import { exchangeXeroCode, getXeroAuthUrl } from "@/lib/xero/client";
import { decryptSecret, isEncrypted } from "@/lib/security/encryption";

const ok = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.ENCRYPTION_KEY = "fixture-encryption-key";
  vi.stubGlobal("fetch", m.fetch);
  m.upsert.mockImplementation((args: unknown) => ({ op: "upsert", args }));
  m.updateMany.mockImplementation((args: unknown) => ({ op: "updateMany", args }));
  m.transaction.mockResolvedValue([]);
  m.fetch.mockImplementation(async (url: string) =>
    url.includes("/connect/token")
      ? ok({ access_token: "ACCESS-T", refresh_token: "REFRESH-T", expires_in: 1800, scope: "offline_access accounting.invoices" })
      : ok([{ tenantId: "tenant-1", tenantName: "Fixture Org" }]),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ENCRYPTION_KEY;
});

it("stores encrypted tokens, the granted scopes and a fresh CONNECTED status, and deactivates other connections", async () => {
  expect(await exchangeXeroCode("code", "https://example.invalid/api/xero/callback")).toEqual({ tenantId: "tenant-1", tenantName: "Fixture Org" });
  const [deactivate, upsert] = m.transaction.mock.calls[0][0] as Array<{ op: string; args: any }>;
  expect(deactivate.args).toMatchObject({ where: { isActive: true, tenantId: { not: "tenant-1" } }, data: { isActive: false } });
  const update = upsert.args.update;
  expect(isEncrypted(update.accessToken) && isEncrypted(update.refreshToken)).toBe(true);
  expect(decryptSecret(update.refreshToken)).toBe("REFRESH-T");
  expect(update).toMatchObject({ status: "CONNECTED", statusReasonCode: null, needsReconnectAt: null, reconnectNoticeAt: null, scopes: ["offline_access", "accounting.invoices"], tokenVersion: { increment: 1 } });
  expect(upsert.args.create.refreshToken).toBe(update.refreshToken);
});

it("refuses to connect without ENCRYPTION_KEY before contacting Xero", async () => {
  delete process.env.ENCRYPTION_KEY;
  await expect(getXeroAuthUrl("https://example.invalid/api/xero/callback", "state")).rejects.toThrow("ENCRYPTION_KEY");
  await expect(exchangeXeroCode("code", "https://example.invalid/api/xero/callback")).rejects.toThrow("ENCRYPTION_KEY");
  expect(m.fetch).not.toHaveBeenCalled();
});

it("requests offline_access in the authorise URL", async () => {
  const url = new URL(await getXeroAuthUrl("https://example.invalid/api/xero/callback", "state"));
  expect(url.searchParams.get("scope")?.split(" ")).toContain("offline_access");
});
