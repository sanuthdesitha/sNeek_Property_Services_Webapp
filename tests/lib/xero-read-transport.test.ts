// @vitest-environment node
/** Xero invoice/credit-note reads: batching, token use, rate limits, typed failures. Mocked fetch only. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ connection: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { xeroConnection: { findFirst: m.connection }, appSetting: { findUnique: async () => null } } }));
import { readXeroCreditNote, readXeroInvoices, hasActiveXeroConnection, XERO_READ_BATCH_SIZE } from "@/lib/xero/client";

const ok = (body: unknown) => ({ ok: true, status: 200, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) });
const invoice = (id: string) => ({ InvoiceID: id, Status: "AUTHORISED", Total: 10, AmountDue: 10, AmountPaid: 0 });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", m.fetch);
  m.connection.mockResolvedValue({ id: "c", tenantId: "tenant", accessToken: "token", refreshToken: "", expiresAt: new Date(Date.now() + 3600_000) });
});
afterEach(() => vi.unstubAllGlobals());

it("reads a batch by IDs with the tenant header and GET", async () => {
  m.fetch.mockResolvedValue(ok({ Invoices: [invoice("a"), invoice("b")] }));
  const reads = await readXeroInvoices(["a", "b"]);
  const [url, init] = m.fetch.mock.calls[0];
  expect(url).toContain("/api.xro/2.0/Invoices?IDs=a%2Cb");
  expect(init).toMatchObject({ method: "GET", headers: expect.objectContaining({ "Xero-tenant-id": "tenant", Authorization: "Bearer token" }) });
  expect(reads.get("a")?.ok).toBe(true);
  expect(reads.get("b")?.ok).toBe(true);
});

it("refuses batches larger than the limit", async () => {
  await expect(readXeroInvoices(Array.from({ length: XERO_READ_BATCH_SIZE + 1 }, (_, i) => `id${i}`))).rejects.toThrow();
});

it("retries once after Retry-After on a 429, then succeeds", async () => {
  const sleep = vi.fn(async () => undefined);
  m.fetch.mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ "Retry-After": "2" }), text: async () => "" }).mockResolvedValueOnce(ok({ Invoices: [invoice("a")] }));
  const reads = await readXeroInvoices(["a"], { sleep });
  expect(sleep).toHaveBeenCalledWith(2000);
  expect(reads.get("a")?.ok).toBe(true);
});

it("reports rate limiting as a typed failure when it persists or the wait is too long", async () => {
  m.fetch.mockResolvedValue({ ok: false, status: 429, headers: new Headers({ "Retry-After": "600" }), text: async () => "" });
  const reads = await readXeroInvoices(["a"], { sleep: async () => undefined });
  expect(reads.get("a")).toMatchObject({ ok: false, failure: { kind: "rate-limited" } });
  expect(m.fetch).toHaveBeenCalledTimes(1);
});

it("never throws: HTTP errors, network errors, bad JSON and no connection all come back typed", async () => {
  m.fetch.mockResolvedValueOnce({ ok: false, status: 500, headers: new Headers(), text: async () => JSON.stringify({ Message: "Boom" }) });
  expect((await readXeroInvoices(["a"])).get("a")).toMatchObject({ ok: false, failure: { kind: "http", reason: expect.stringContaining("Boom") } });
  m.fetch.mockRejectedValueOnce(new Error("socket hang up"));
  expect((await readXeroInvoices(["a"])).get("a")).toMatchObject({ ok: false, failure: { kind: "network" } });
  m.fetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new Error("bad"); } });
  expect((await readXeroInvoices(["a"])).get("a")).toMatchObject({ ok: false, failure: { kind: "unparseable" } });
  m.connection.mockResolvedValue(null);
  expect((await readXeroInvoices(["a"])).get("a")).toMatchObject({ ok: false, failure: { kind: "not-connected" } });
  expect(await hasActiveXeroConnection()).toBe(false);
});

it("refreshes an expiring token before reading, as the push does (no refresh token → not connected)", async () => {
  m.connection.mockResolvedValue({ id: "c", tenantId: "t", accessToken: "old", refreshToken: "", expiresAt: new Date(Date.now() - 1000) });
  const reads = await readXeroInvoices(["a"]);
  expect(reads.get("a")).toMatchObject({ ok: false, failure: { kind: "not-connected" } });
  expect(m.fetch).not.toHaveBeenCalled();
});

it("reads one credit note by id", async () => {
  m.fetch.mockResolvedValue(ok({ CreditNotes: [{ CreditNoteID: "cn", Status: "AUTHORISED", Total: 20, RemainingCredit: 20 }] }));
  const read = await readXeroCreditNote("cn");
  expect(m.fetch.mock.calls[0][0]).toContain("/api.xro/2.0/CreditNotes/cn");
  expect(read).toMatchObject({ ok: true, document: { kind: "ACCRECCREDIT", total: 20 } });
});
