import { beforeEach, describe, expect, it, vi } from "vitest";
import { changePropertyFavorites, readPropertyFavorites, propertyFavoritesKey, requirePropertyFavoritesContext } from "@/lib/client/property-favorites-store";
const mocks = vi.hoisted(() => ({ read: vi.fn(), properties: vi.fn(), write: vi.fn(), lock: vi.fn(), portal: vi.fn(), session: vi.fn(), settings: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/db", () => { const tx = { appSetting: { findUnique: mocks.read, upsert: mocks.write }, property: { findMany: mocks.properties }, $executeRaw: mocks.lock }; return { db: { ...tx, $transaction: (f: any) => f(tx) } }; });
vi.mock("@/lib/auth/client-portal", () => ({ requireClientPortal: mocks.portal, propertyScopeWhere: (p: any) => ({ clientId: p.clientId, ...(p.propertyIds ? { id: { in: p.propertyIds } } : {}) }) }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/settings", () => ({ getAppSettings: mocks.settings, DEFAULT_SETTINGS: {} }));
vi.mock("@/lib/portal-access", () => ({ isClientModuleEnabled: mocks.enabled }));
const portal = { userId: "user", clientId: "client", actor: "VA", team: { id: "team" }, propertyIds: ["allowed"], visibility: {} } as any;
const state = { version: 1, revision: 3, ids: ["allowed", "hidden"], view: "cards" };
beforeEach(() => { vi.resetAllMocks(); mocks.read.mockResolvedValue({ value: state }); mocks.properties.mockResolvedValue([{ id: "allowed" }]); mocks.portal.mockResolvedValue(portal); mocks.session.mockResolvedValue({ user: { id: "user" } }); mocks.settings.mockResolvedValue({}); mocks.enabled.mockReturnValue(true); });
describe("personal property favorites", () => {
  it("scopes keys by login, client and team, and filters hidden IDs only in the response", async () => {
    expect(propertyFavoritesKey(portal)).not.toBe(propertyFavoritesKey({ ...portal, userId: "other" }));
    expect(await readPropertyFavorites(portal)).toEqual({ ...state, ids: ["allowed"] });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.properties).toHaveBeenCalledWith({ where: { clientId: "client", id: { in: ["allowed"] }, isActive: true }, select: { id: true } });
  });
  it("preserves hidden pins when changing view under a transaction lock", async () => {
    expect(await changePropertyFavorites(portal, { action: "view", view: "compact", revision: 3 })).toEqual({ ...state, revision: 4, ids: ["allowed"], view: "compact" });
    expect(mocks.write.mock.calls[0][0].update.value.ids).toEqual(["allowed", "hidden"]); expect(mocks.lock).toHaveBeenCalledOnce();
  });
  it("initializes new preferences and supports idempotent pin/unpin and explicit clear", async () => {
    mocks.read.mockResolvedValue(null);
    expect(await changePropertyFavorites(portal, { action: "pin", propertyId: "allowed", revision: 0 })).toMatchObject({ ids: ["allowed"], revision: 1 });
    mocks.read.mockResolvedValue({ value: state });
    expect(await changePropertyFavorites(portal, { action: "pin", propertyId: "allowed", revision: 3 })).toMatchObject({ ids: ["allowed"] });
    expect(await changePropertyFavorites(portal, { action: "unpin", propertyId: "allowed", revision: 3 })).toMatchObject({ ids: [] });
    expect(await changePropertyFavorites(portal, { action: "clear", revision: 3 })).toMatchObject({ ids: [] });
    expect(mocks.write.mock.calls.at(-1)?.[0].update.value.ids).toEqual([]);
  });
  it.each([
    [{ action: "pin", propertyId: "hidden", revision: 3 }, 404],
    [{ action: "unpin", propertyId: "allowed", revision: 2 }, 409],
    [{ action: "clear", revision: 3, userId: "victim" }, 400],
    [{ action: "pin", propertyId: "", revision: 3 }, 400],
  ])("rejects invalid, unauthorized and stale writes", async (input, status) => {
    await expect(changePropertyFavorites(portal, input)).rejects.toMatchObject({ status }); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("preserves corrupted data and propagates database failures", async () => {
    mocks.read.mockResolvedValue({ value: { ...state, ids: ["allowed", "allowed"] } });
    await expect(readPropertyFavorites(portal)).rejects.toMatchObject({ status: 503 });
    await expect(changePropertyFavorites(portal, { action: "clear", revision: 3 })).rejects.toMatchObject({ status: 503 }); expect(mocks.write).not.toHaveBeenCalled();
    mocks.read.mockRejectedValue(new Error("offline")); await expect(readPropertyFavorites(portal)).rejects.toThrow("offline");
  });
  it("binds context to effective scope and impersonation and disallows impersonated edits", async () => {
    const original = await requirePropertyFavoritesContext(); expect(original.readOnly).toBe(false);
    mocks.portal.mockResolvedValue({ ...portal, propertyIds: ["second"] }); expect((await requirePropertyFavoritesContext()).context).not.toBe(original.context);
    mocks.session.mockResolvedValue({ user: { id: "user" }, impersonation: { actorId: "admin", mode: "FULL", startedAt: "now" } });
    expect((await requirePropertyFavoritesContext()).readOnly).toBe(true);
  });
  it("rejects disabled module or changing identity", async () => {
    mocks.enabled.mockReturnValue(false); await expect(requirePropertyFavoritesContext()).rejects.toMatchObject({ status: 403 });
    mocks.enabled.mockReturnValue(true); mocks.session.mockResolvedValue({ user: { id: "other" } }); await expect(requirePropertyFavoritesContext()).rejects.toMatchObject({ status: 403 });
  });
});
