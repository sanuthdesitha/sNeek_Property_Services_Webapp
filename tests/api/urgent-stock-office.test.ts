// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), office: vi.fn(), bulk: vi.fn(), redirect: vi.fn((href: string) => { throw new Error(`REDIRECT ${href}`); }) }));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.session }));
vi.mock("@/lib/inventory/urgent-stock", () => ({ listUrgentStock: m.list, reportUrgentStock: vi.fn(), actOnUrgentStock: vi.fn(), setUrgentStockSettings: vi.fn() }));
vi.mock("@/lib/inventory/urgent-stock-list", () => ({ listUrgentNeedsForOffice: m.office, parseUrgentFilters: (params: URLSearchParams) => ({ filter: params.get("stage") ?? "open" }), URGENT_SORTS: ["neededBy", "item"] }));
vi.mock("@/lib/inventory/urgent-stock-bulk", () => ({ runUrgentStockBulk: m.bulk }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/components/inventory/urgent-stock-workspace", () => ({ UrgentStockWorkspace: () => null }));
import { GET } from "@/app/api/inventory/urgent-stock/route";
import { POST as bulk } from "@/app/api/inventory/urgent-stock/bulk/route";
import UrgentStockPage from "@/app/urgent-stock/page";

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.list.mockResolvedValue({ properties: [], items: [], reports: [], events: [], settings: null });
  m.office.mockResolvedValue({ rows: [], total: 0 });
});

it("keeps the per-property response for existing callers and adds the office list only on request", async () => {
  await GET(new NextRequest("https://app.invalid/api/inventory/urgent-stock?propertyId=p&paginated=1"));
  expect(m.list).toHaveBeenCalledWith({ id: "admin", role: "ADMIN" }, "p", undefined);
  expect(m.office).not.toHaveBeenCalled();
  const response = await GET(new NextRequest("https://app.invalid/api/inventory/urgent-stock?paginated=1&stage=open"));
  expect(response.status).toBe(200);
  expect(m.office).toHaveBeenCalledWith({ id: "admin", role: "ADMIN" }, { filter: "open" }, expect.objectContaining({ sort: "neededBy", dir: "asc", page: 1 }));
  expect((await GET(new NextRequest("https://app.invalid/api/inventory/urgent-stock?paginated=1&sort=price"))).status).toBe(400);
  m.office.mockRejectedValueOnce(new Error("FORBIDDEN"));
  expect((await GET(new NextRequest("https://app.invalid/api/inventory/urgent-stock?paginated=1"))).status).toBe(403);
});

it("bulk requires the same origin and passes the server identity", async () => {
  const cross = await bulk(new NextRequest("https://app.invalid/api/inventory/urgent-stock/bulk", { method: "POST", headers: { origin: "https://other.invalid" }, body: "{}" }));
  expect(cross.status).toBe(403);
  expect(m.bulk).not.toHaveBeenCalled();
  m.bulk.mockResolvedValue({ results: [] });
  const ok = await bulk(new NextRequest("https://app.invalid/api/inventory/urgent-stock/bulk", { method: "POST", headers: { origin: "https://app.invalid", host: "app.invalid", "x-forwarded-proto": "https" }, body: JSON.stringify({ action: "close" }) }));
  expect(ok.status).toBe(200);
  expect(m.bulk).toHaveBeenCalledWith({ id: "admin", role: "ADMIN" }, { action: "close" });
});

it("redirects administrators from /urgent-stock into Stock, keeping the property; cleaners keep their page", async () => {
  await expect(UrgentStockPage({ searchParams: { propertyId: "p-1" } })).rejects.toThrow("REDIRECT /v2/admin/inventory?tab=urgent-stock&propertyId=p-1");
  m.session.mockResolvedValueOnce({ user: { id: "c", role: "CLEANER" } });
  expect(await UrgentStockPage({ searchParams: { propertyId: "p-1" } })).toBeTruthy();
  m.session.mockResolvedValueOnce({ user: { id: "o", role: "OPS_MANAGER" } });
  const ops = await UrgentStockPage({});
  expect(JSON.stringify(ops)).toContain("administrators and assigned cleaners");
  expect(m.redirect).toHaveBeenCalledTimes(1);
});
