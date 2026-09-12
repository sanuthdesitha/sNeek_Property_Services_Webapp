import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientTodayKey, loadPropertyHomeRows } from "@/lib/client/property-home";
const mocks = vi.hoisted(() => ({ properties: vi.fn(), approvals: vi.fn(), scope: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { property: { findMany: mocks.properties } } }));
vi.mock("@/lib/auth/client-portal", () => ({ propertyScopeWhere: mocks.scope }));
vi.mock("@/lib/commercial/client-approvals", () => ({ listClientApprovals: mocks.approvals }));
const portal = () => ({ clientId: "client", actor: "CLIENT", permissions: { properties: true, reports: true }, visibility: { showProperties: true, showJobs: true, showReports: true, showApprovals: true, showLiveProgress: true } }) as any;
const property = { id: "p1", name: "Harbour", suburb: "Sydney", bedrooms: 2, bathrooms: 1, hasBalcony: true,
  jobs: [{ id: "j1", scheduledDate: new Date("2026-10-04T00:00:00Z"), startTime: "09:00", status: "EN_ROUTE", updatedAt: new Date("2026-10-03T23:00:00Z") }] };
beforeEach(() => { vi.resetAllMocks(); mocks.scope.mockReturnValue({ clientId: "client", id: { in: ["p1"] } }); mocks.properties.mockResolvedValueOnce([property]).mockResolvedValueOnce([{ id: "p1", jobs: [{ id: "old", scheduledDate: new Date("2026-09-01T00:00:00Z"), report: { id: "r1", clientVisible: true } }] }]); mocks.approvals.mockResolvedValue([{ propertyId: "p1" }, { propertyId: "other" }, { propertyId: null }]); });
describe("property home projection", () => {
  it("uses Sydney today with UTC date-only job keys across DST", () => {
    expect(clientTodayKey(new Date("2026-10-03T14:30:00Z")).toISOString()).toBe("2026-10-04T00:00:00.000Z");
    expect(clientTodayKey(new Date("2026-04-04T13:30:00Z")).toISOString()).toBe("2026-04-05T00:00:00.000Z");
  });
  it("loads one next job per authorized property and exposes only shared results", async () => {
    const rows = await loadPropertyHomeRows(portal(), new Date("2026-10-03T14:30:00Z"));
    expect(rows[0]).toMatchObject({ next: { day: "2026-10-04", phase: "Cleaner on the way" }, last: { reportId: "r1" }, approvals: 1 });
    expect(mocks.properties.mock.calls[0][0]).toMatchObject({ where: { clientId: "client", id: { in: ["p1"] }, isActive: true }, select: { jobs: { take: 1, where: { scheduledDate: { gte: new Date("2026-10-04T00:00:00Z") } } } } });
    expect(rows[0]).not.toHaveProperty("jobs");
  });
  it("keeps history and approvals failures distinct from no records", async () => {
    mocks.properties.mockReset().mockResolvedValueOnce([property]).mockRejectedValueOnce(new Error("offline")); mocks.approvals.mockRejectedValue(new Error("offline"));
    expect((await loadPropertyHomeRows(portal()))[0]).toMatchObject({ last: "unavailable", approvals: "unavailable" });
  });
  it("does not return hidden reports, progress or VA approval data", async () => {
    const ctx = portal(); ctx.actor = "VA"; ctx.visibility.showLiveProgress = false; ctx.permissions.reports = false;
    expect((await loadPropertyHomeRows(ctx))[0]).toMatchObject({ next: { phase: null }, last: { reportId: null }, approvals: "hidden" });
    expect(mocks.approvals).not.toHaveBeenCalled();
  });
  it("does not leak an unreleased report", async () => {
    mocks.properties.mockReset().mockResolvedValueOnce([property]).mockResolvedValueOnce([{ id: "p1", jobs: [{ id: "old", scheduledDate: new Date(), report: { id: "secret", clientVisible: false } }] }]);
    expect((await loadPropertyHomeRows(portal()))[0].last).toMatchObject({ reportId: null });
  });
  it("omits all job identifiers and skips history reads when services are hidden", async () => {
    const ctx = portal(); ctx.visibility.showJobs = false;
    expect((await loadPropertyHomeRows(ctx))[0]).toMatchObject({ next: "hidden", last: "hidden" });
    expect(mocks.properties).toHaveBeenCalledOnce();
    expect(mocks.properties.mock.calls[0][0].select.jobs).toBe(false);
  });
  it("keeps actual emptiness and fails the main property read explicitly", async () => {
    mocks.properties.mockReset().mockResolvedValueOnce([{ ...property, jobs: [] }]).mockResolvedValueOnce([]); mocks.approvals.mockResolvedValue([]);
    expect((await loadPropertyHomeRows(portal()))[0]).toMatchObject({ next: null, last: null, approvals: 0 });
    mocks.properties.mockRejectedValue(new Error("offline")); await expect(loadPropertyHomeRows(portal())).rejects.toThrow("offline");
  });
  it.each(["visibility", "permissions"])("does not query without %s property access", async source => {
    const ctx = portal(); ctx[source][source === "visibility" ? "showProperties" : "properties"] = false;
    expect(await loadPropertyHomeRows(ctx)).toEqual([]); expect(mocks.properties).not.toHaveBeenCalled();
  });
});
