// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), portal: vi.fn(), enabled: vi.fn(), purchases: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/auth/client-portal", () => ({ requireClientPortal: m.portal }));
vi.mock("@/lib/portal-access", () => ({ isClientModuleEnabled: m.enabled }));
vi.mock("@/lib/inventory/client-purchases", () => ({ getClientPurchases: m.purchases }));
import { GET } from "@/app/api/client/inventory/purchases/route";
beforeEach(() => { vi.resetAllMocks(); m.role.mockResolvedValue({ user: { id: "client" } }); m.portal.mockResolvedValue({ actor: "CLIENT", clientId: "client-a", settings: {}, visibility: { shopping: true } }); m.enabled.mockReturnValue(true); m.purchases.mockResolvedValue({ runs: [], hasMore: false }); });
it("uses server client identity and merged visibility with private response", async () => { const response = await GET(); expect(m.role).toHaveBeenCalledWith(["CLIENT"]); expect(m.purchases).toHaveBeenCalledWith("client-a"); expect(m.enabled).toHaveBeenCalledWith({ clientPortalVisibility: { shopping: true } }, "shopping"); expect(response.headers.get("cache-control")).toBe("private, no-store"); });
it("denies hidden shopping and does not add an ungranted VA capability", async () => { m.enabled.mockReturnValue(false); expect((await GET()).status).toBe(403); m.enabled.mockReturnValue(true); m.portal.mockResolvedValue({ actor: "VA", clientId: "client-a" }); expect((await GET()).status).toBe(403); expect(m.purchases).not.toHaveBeenCalled(); });
it("hides database failure details", async () => { m.purchases.mockRejectedValue(new Error("secret-db")); const response = await GET(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret-db"); });
