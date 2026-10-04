// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), jobs: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { job: { findMany: m.jobs } } }));
import { GET } from "@/app/api/admin/properties/[id]/jobs/route";
const row = (patch = {}) => ({ id: "j", status: "COMPLETED", completedAt: new Date("2026-09-18T01:00:00Z"), scheduledDate: new Date("2026-09-18"), assignments: [], qaReviews: [], formSubmissions: [], report: null, laundryTask: null, _count: { issueTickets: 0, maintenanceItems: 0 }, ...patch });
const get = () => GET(new Request("http://localhost"), { params: { id: "p" } });
beforeEach(() => { vi.resetAllMocks(); m.jobs.mockResolvedValue([]); });
it("counts all cases independently of maintenance and retains legacy count alias", async () => {
 m.jobs.mockResolvedValue([row({ _count: { issueTickets: 2, maintenanceItems: 1 } }), row({ id: "future", status: "OFFERED", completedAt: null, scheduledDate: new Date("2027-01-01"), _count: { issueTickets: 3, maintenanceItems: 4 } })]);
 const result = await get(); expect(result.status).toBe(200); const body = await result.json();
 expect(body.stats).toMatchObject({ caseCount: 5, openIssues: 5, maintenanceItems: 5, total: 2, completed: 1, upcoming: 1, lastCompleted: "2026-09-18T01:00:00.000Z" });
 expect(m.jobs.mock.calls[0][0].where).toEqual({ propertyId: "p" });
});
it("shapes evidence and deduplicated cleaner names; completed dates outrank scheduled dates", async () => {
 m.jobs.mockResolvedValue([row({ assignments: [{ user: { name: " Cleaner " } }, { user: { name: "Cleaner" } }, { user: { email: "worker@example.test" } }, { user: null }], qaReviews: [{ score: 91.4, passed: true }], formSubmissions: [{ createdAt: new Date("2026-09-18"), laundryOutcome: "READY" }], report: { clientVisible: true }, laundryTask: { id: "l" } }), row({ id: "later", status: "INVOICED", completedAt: new Date("2026-09-20"), qaReviews: [{ score: null, passed: false }] }), row({ id: "skip", status: "UNASSIGNED", completedAt: null, cleanSkipStatus: "SKIPPED" })]);
 const body = await (await get()).json(); expect(body.jobs[0]).toMatchObject({ cleaners: ["Cleaner", "worker@example.test"], hasForm: true, hasReport: true, reportClientVisible: true, hasLaundry: true });
 expect(body.stats).toMatchObject({ avgQa: 46, qaPassRate: 50, skipped: 1, upcoming: 0, lastCompleted: "2026-09-20T00:00:00.000Z" });
});
it("empty history has unknown QA and completion baseline", async () => {
 const body = await (await get()).json(); expect(body.stats).toMatchObject({ caseCount: 0, avgQa: null, qaPassRate: null, lastCompleted: null });
});
it("authorization denial never queries history", async () => { m.auth.mockRejectedValue(new Error("FORBIDDEN")); expect((await get()).status).toBe(401); expect(m.jobs).not.toHaveBeenCalled(); });
it("query failure is an error, not an empty successful history", async () => { m.jobs.mockRejectedValue(new Error("unavailable")); expect((await get()).status).toBe(500); });
