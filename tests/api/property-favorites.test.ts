import { beforeEach, expect, it, vi } from "vitest";
import { GET, PATCH } from "@/app/api/client/property-favorites/route";
const mocks = vi.hoisted(() => ({ owner: vi.fn(), read: vi.fn(), change: vi.fn() }));
vi.mock("@/lib/client/property-favorites-store", () => ({ requirePropertyFavoritesContext: mocks.owner, readPropertyFavorites: mocks.read, changePropertyFavorites: mocks.change,
  PropertyFavoritesError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
const request = (context = "owned", body = '{"action":"clear","revision":0}') => new Request("http://localhost/api/client/property-favorites", { method: "PATCH", headers: { "X-Property-Preferences-Context": context }, body });
beforeEach(() => { vi.resetAllMocks(); mocks.owner.mockResolvedValue({ portal: { userId: "owner" }, context: "owned", readOnly: false }); mocks.read.mockResolvedValue({ revision: 0 }); mocks.change.mockResolvedValue({ revision: 1 }); });
it("marks preferences private and uses the authenticated owner", async () => {
  const result = await GET(); expect(result.headers.get("Cache-Control")).toBe("private, no-store"); expect(result.headers.get("Vary")).toBe("Cookie");
  expect(mocks.read).toHaveBeenCalledWith({ userId: "owner" }); expect((await result.json()).context).toBe("owned");
});
it.each(["other", ""])("rejects missing or different context %s without writing", async context => {
  expect((await PATCH(request(context))).status).toBe(403); expect(mocks.change).not.toHaveBeenCalled();
});
it("rejects impersonated writes", async () => {
  mocks.owner.mockResolvedValue({ portal: {}, context: "owned", readOnly: true }); expect((await PATCH(request())).status).toBe(403); expect(mocks.change).not.toHaveBeenCalled();
});
it("forwards only owner and parsed mutation and returns a new receipt", async () => {
  expect((await PATCH(request())).status).toBe(200); expect(mocks.change).toHaveBeenCalledWith({ userId: "owner" }, { action: "clear", revision: 0 });
});
it("never exposes a database exception", async () => {
  mocks.read.mockRejectedValue(new Error("database-secret")); const result = await GET(); expect(result.status).toBe(503); expect(JSON.stringify(await result.json())).not.toContain("database-secret");
});
