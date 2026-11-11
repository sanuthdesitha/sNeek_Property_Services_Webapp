// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/billing/client-invoice-xero-sync", () => ({ refreshInvoicesFromXero: m.refresh }));
import { POST } from "@/app/api/admin/invoices/xero-sync/route";
const post = (body: unknown) => POST(new NextRequest("http://local/api/admin/invoices/xero-sync", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "ops", role: "OPS_MANAGER" } });
  m.refresh.mockResolvedValue({ results: [], counts: {}, remaining: 0 });
});
it("uses the same roles as the Xero push (ADMIN and OPS_MANAGER)", async () => {
  await post({ ids: ["a"] });
  expect(m.auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
  expect(m.refresh).toHaveBeenCalledWith({ ids: ["a"], actor: { id: "ops", role: "OPS_MANAGER" } });
});
it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]])("answers %s with %i", async (message, status) => {
  m.auth.mockRejectedValue(new Error(message));
  expect((await post({ ids: ["a"] })).status).toBe(status);
  expect(m.refresh).not.toHaveBeenCalled();
});
it("validates the ids and de-duplicates them", async () => {
  expect((await post({ ids: [] })).status).toBe(400);
  expect((await post({ ids: Array.from({ length: 51 }, (_, i) => `i${i}`) })).status).toBe(400);
  await post({ ids: ["a", "a", "b"] });
  expect(m.refresh.mock.calls[0][0].ids).toEqual(["a", "b"]);
});
