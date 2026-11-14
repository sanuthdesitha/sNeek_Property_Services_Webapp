// @vitest-environment node
/** Add client's Xero lookup only ever GETs through the token service (2026-11-16). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/xero/token-service", async (original) => ({
  ...(await original<typeof import("@/lib/xero/token-service")>()),
  getXeroAccessToken: vi.fn(async () => ({ ok: true, refreshed: false, token: { accessToken: "a", tenantId: "t", tokenVersion: 1, connectionId: "c", tenantName: "Org", expiresAt: new Date(Date.now() + 3_600_000) } })),
  verifyXeroTenant: vi.fn(async () => ({ state: "present" })),
}));

import { readXeroContact, searchXeroContacts } from "@/lib/xero/client";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("Xero contact lookup", () => {
  it("searches with a single GET and lists active contacts", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ Contacts: [
      { ContactID: "11111111-1111-1111-1111-111111111111", Name: "Seaside Stays", EmailAddress: "ops@seaside.example", ContactStatus: "ACTIVE" },
      { ContactID: "22222222-2222-2222-2222-222222222222", Name: "Old", ContactStatus: "ARCHIVED" },
    ] }), { status: 200 }));
    const result = await searchXeroContacts("Seaside");
    expect(result).toEqual({ ok: true, contacts: [{ id: "11111111-1111-1111-1111-111111111111", name: "Seaside Stays", email: "ops@seaside.example", status: "ACTIVE" }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchMock.mock.calls[0];
    expect(String(requestUrl)).toContain("/api.xro/2.0/Contacts?searchTerm=Seaside");
    expect((init as RequestInit).method ?? "GET").toBe("GET");
  });

  it("reads one contact by id with GET, and reports a failure in words without throwing", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ Contacts: [{ ContactID: "11111111-1111-1111-1111-111111111111", Name: "Seaside Stays" }] }), { status: 200 }));
    expect(await readXeroContact("11111111-1111-1111-1111-111111111111")).toMatchObject({ ok: true, contact: { name: "Seaside Stays" } });
    expect((fetchMock.mock.calls[0][1] as RequestInit).method ?? "GET").toBe("GET");
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect(await readXeroContact("11111111-1111-1111-1111-111111111111")).toMatchObject({ ok: false, reason: expect.stringMatching(/Xero API error \(500\)/) });
    expect(await readXeroContact("not-an-id")).toMatchObject({ ok: false });
  });
});
