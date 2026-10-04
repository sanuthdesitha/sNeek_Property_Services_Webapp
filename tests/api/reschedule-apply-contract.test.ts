// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/phase4/analytics", () => ({ applyReschedule: m.apply }));
import { POST } from "@/app/api/admin/phase4/reschedule/[jobId]/apply/route";
const post = (body: unknown) => POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify(body) }), { params: { jobId: "job" } });
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "admin" } }); m.apply.mockResolvedValue({ id: "job", scheduledDate: "2026-10-07", startTime: null, dueTime: null }); });
it("forwards explicit time clearing, reviewer revision and trimmed reason without dropping nulls", async () => {
 const expectedUpdatedAt = "2026-10-03T00:00:00.123Z";
 const result = await post({ date: "2026-10-07", startTime: null, dueTime: null, reason: " Changed guest arrival ", expectedUpdatedAt });
 expect(result.status).toBe(200); expect(m.auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
 expect(m.apply).toHaveBeenCalledWith({ jobId: "job", userId: "admin", date: "2026-10-07", startTime: null, dueTime: null, reason: "Changed guest arrival", expectedUpdatedAt });
 expect(await result.json()).toMatchObject({ id: "job", startTime: null, dueTime: null });
});
it("omitted times remain undefined so service retains existing schedule details", async () => {
 expect((await post({ date: "2026-10-07" })).status).toBe(200);
 expect(m.apply).toHaveBeenCalledWith(expect.objectContaining({ startTime: undefined, dueTime: undefined, reason: null, expectedUpdatedAt: undefined }));
});
it.each([{ date: "invalid" }, { date: "2026-10-07", expectedUpdatedAt: "yesterday" }, { date: "2026-10-07", startTime: "123456" }, {}])("rejects malformed request before state mutation %j", async body => {
 expect((await post(body)).status).toBe(400); expect(m.apply).not.toHaveBeenCalled();
});
it.each([["UNAUTHORIZED",401],["FORBIDDEN",403]])("authorization failure %s cannot reach rescheduler", async (message,status) => {
 m.auth.mockRejectedValue(new Error(String(message))); expect((await post({ date: "2026-10-07" })).status).toBe(status); expect(m.apply).not.toHaveBeenCalled();
});
it.each(["This job changed. Reload before rescheduling.", "Job not found.", "Enter a valid start and finish window."]) ("returns service failure without reporting a saved schedule: %s", async message => {
 m.apply.mockRejectedValue(new Error(message)); const response = await post({ date: "2026-10-07" }); expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: message });
});
it("malformed JSON cannot silently invoke an empty reschedule", async () => {
 const result = await POST(new NextRequest("http://localhost", { method: "POST", body: "{" }), { params: { jobId: "j" } });
 expect(result.status).toBe(400); expect(m.apply).not.toHaveBeenCalled();
});
it("unknown service rejection returns a stable error rather than empty success", async () => {
 m.apply.mockRejectedValue({}); const result = await post({ date: "2026-10-07" });
 expect(result.status).toBe(400); expect(await result.json()).toEqual({ error: "Could not apply reschedule." });
});
