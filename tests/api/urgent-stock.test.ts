// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn(), report: vi.fn(), act: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.session }));
vi.mock("@/lib/inventory/urgent-stock", () => ({ listUrgentStock: m.list, reportUrgentStock: m.report, actOnUrgentStock: m.act, setUrgentStockSettings: m.settings }));
import { GET, POST } from "@/app/api/inventory/urgent-stock/route";
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ user: { id: "cleaner", role: "CLEANER" } }); m.list.mockResolvedValue({ properties: [] }); });
it("uses the server identity and never caches scoped reads", async () => {
 const response = await GET(new NextRequest("https://app.invalid/api/inventory/urgent-stock?propertyId=p&reportId=r"));
 expect(m.list).toHaveBeenCalledWith({ id: "cleaner", role: "CLEANER" }, "p", "r");
 expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("rejects unauthenticated and forbidden reads", async () => {
 m.session.mockRejectedValue(new Error("UNAUTHORIZED")); expect((await GET(new NextRequest("https://app.invalid/api/inventory/urgent-stock"))).status).toBe(401);
 m.session.mockResolvedValue({ user: { id: "cleaner", role: "CLEANER" } }); m.list.mockRejectedValue(new Error("FORBIDDEN"));
 expect((await GET(new NextRequest("https://app.invalid/api/inventory/urgent-stock?propertyId=other"))).status).toBe(403);
});
it("blocks cross-origin mutations before touching data", async () => {
 const response = await POST(new NextRequest("https://app.invalid/api/inventory/urgent-stock", { method: "POST", headers: { origin: "https://other.invalid" }, body: JSON.stringify({ action: "report" }) }));
 expect(response.status).toBe(403); expect(m.report).not.toHaveBeenCalled();
});
it("returns a conflict without silently overwriting a changed report", async () => {
 m.act.mockRejectedValue(new Error("CONFLICT: reload"));
 const response = await POST(new NextRequest("http://0.0.0.0:3000/api/inventory/urgent-stock", { method: "POST", headers: { origin: "https://app.invalid", host: "app.invalid", "x-forwarded-proto": "https" }, body: JSON.stringify({ action: "transition", expectedVersion: 1 }) }));
 expect(response.status).toBe(409); expect(m.act).toHaveBeenCalledWith({ id: "cleaner", role: "CLEANER" }, { expectedVersion: 1 });
});
