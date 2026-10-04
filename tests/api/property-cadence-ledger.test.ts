// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { job: { findMany: m.read } } }));
import { GET } from "@/app/api/admin/properties/[id]/cadence-ledger/route";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";
const get = () => GET(new Request("http://localhost"), { params: { id: "property" } });
beforeEach(() => { vi.resetAllMocks(); m.read.mockResolvedValue([]); });
it("reads only completed nonfuture nonrework property jobs and exposes empty baseline", async () => {
 const response = await get(); expect(response.status).toBe(200);
 expect(m.auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
 expect(m.read).toHaveBeenCalledWith(expect.objectContaining({ where: { propertyId: "property", status: { in: ["COMPLETED", "INVOICED"] }, completedAt: { lte: expect.any(Date) }, isRework: false }, take: 500, orderBy: { completedAt: "desc" } }));
 expect(await response.json()).toMatchObject({ reviewedJobs: 0, limited: false, rows: Array.from({ length: 4 }, () => expect.objectContaining({ status: "UNVERIFIED" })) });
});
it("removes drafts from evidence and discloses the 500-row search limit", async () => {
 const draft = { id: "draft", jobType: "DEEP_CLEAN", status: "COMPLETED", completedAt: new Date("2026-01-01"), internalNotes: serializeJobInternalNotes({ isDraft: true }), jobTasks: [], formSubmissions: [{ data: {}, media: [{ s3Key: "proof" }] }] };
 m.read.mockResolvedValue([...Array(499).fill(draft), { ...draft, id: "live", internalNotes: null }]);
 const body = await (await get()).json();
 expect(body.limited).toBe(true); expect(body.reviewedJobs).toBe(500);
 expect(body.rows[0].lastEvidence.jobId).toBe("live");
});
it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403], ["database unavailable", 500]])("returns safe response for %s", async (message, status) => {
 m.auth.mockRejectedValue(new Error(String(message))); const response = await get();
 expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: "Could not load the cadence evidence ledger." }); expect(m.read).not.toHaveBeenCalled();
});
