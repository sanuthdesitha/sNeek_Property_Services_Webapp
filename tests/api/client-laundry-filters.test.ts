import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ scope: vi.fn(), rows: vi.fn(), portal: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { laundryTask: { findMany: m.rows } } }));
vi.mock("@/lib/auth/client-portal", () => ({ resolvePortalScopeForUser: m.scope, requireClientPortal: m.portal }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));
vi.mock("@/lib/portal-access", () => ({ isClientModuleEnabled: m.enabled }));
vi.mock("@/lib/forms/resolve-job-template", () => ({ resolveJobFormTemplate: vi.fn() }));
import { GET } from "@/app/api/client/laundry/route";
import { listClientLaundryForUser } from "@/lib/client/portal-data";
beforeEach(() => {
  vi.clearAllMocks();
  m.scope.mockResolvedValue({ clientId: "client", propertyIds: ["allowed"] });
  m.portal.mockResolvedValue({ userId: "va", visibility: {} }); m.enabled.mockReturnValue(true);
  m.rows.mockResolvedValue([]);
});
function get(query = "") { return GET(new Request(`http://localhost/api/client/laundry${query ? `?${query}` : ""}`)); }
it("ANDs requested properties with VA scope and permits explicitly requested historical dates", async () => {
  const response = await get("propertyId=not-allowed&status=PICKED_UP&from=2020-01-01&to=2020-01-31&dateField=pickup");
  expect(response.status).toBe(200);
  expect(m.rows).toHaveBeenCalledWith(expect.objectContaining({ where: {
    property: { clientId: "client", id: { in: ["allowed"] } }, propertyId: "not-allowed", status: "PICKED_UP",
    pickupDate: { gte: new Date("2019-12-31T13:00:00Z"), lte: new Date("2020-01-31T12:59:59.999Z") },
  }, take: 200, orderBy: [{ pickupDate: "desc" }, { updatedAt: "desc" }, { id: "desc" }] }));
});
it("matches any cleaning, pickup or dropoff date over the full Sydney DST transition day", async () => {
  expect((await get("from=2026-10-04&to=2026-10-04&dateField=any")).status).toBe(200);
  const range = { gte: new Date("2026-10-03T14:00:00Z"), lte: new Date("2026-10-04T12:59:59.999Z") };
  expect(m.rows.mock.calls[0][0].where).toEqual({ property: { clientId: "client", id: { in: ["allowed"] } }, OR: [{ pickupDate: range }, { dropoffDate: range }, { job: { scheduledDate: range } }] });
});
it.each(["cleaning", "dropoff"])("uses only the selected %s date field", async field => {
  await get(`from=2020-01-01&dateField=${field}`);
  const where = m.rows.mock.calls[0][0].where;
  expect(where.OR).toBeUndefined(); expect(where.pickupDate).toBeUndefined();
  expect(field === "cleaning" ? where.job.scheduledDate : where.dropoffDate).toEqual({ gte: new Date("2019-12-31T13:00:00Z") });
});
it.each(["from=2026-02-30", "from=not-a-date", "from=2026-10-04&to=2026-10-03", "dateField=unknown", "status=unknown", "propertyId="])("rejects invalid filters %s before the data query", async query => {
  expect((await get(query)).status).toBe(400); expect(m.rows).not.toHaveBeenCalled();
});
it("preserves default recent pickup selection, newest first, and confirmation metadata", async () => {
  m.rows.mockResolvedValue([{ id: "task", confirmations: [{ notes: '{"bagCount":2}' }] }]);
  const rows = await listClientLaundryForUser("va");
  expect(m.rows.mock.calls[0][0].where.pickupDate.gte).toBeInstanceOf(Date);
  expect(m.rows.mock.calls[0][0].where.OR).toBeUndefined();
  expect(rows[0].confirmations[0].meta).toEqual({ bagCount: 2 });
});
it("never queries laundry for missing scope or disabled visibility", async () => {
  m.scope.mockResolvedValue(null); expect(await listClientLaundryForUser("va")).toEqual([]);
  m.enabled.mockReturnValue(false); expect((await get()).status).toBe(403);
  expect(m.rows).not.toHaveBeenCalled();
});
