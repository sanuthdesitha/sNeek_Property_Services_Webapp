// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), job: vi.fn(), report: vi.fn(), generate: vi.fn(), settings: vi.fn(), notice: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.job }, report: { findUnique: m.report }, notification: { create: m.notice } } }));
vi.mock("@/lib/reports/generator", () => ({ generateJobReport: m.generate }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
import { POST } from "@/app/api/admin/reports/[jobId]/generate/route";
const params = { params: { jobId: "job1" } };
const req = (url = "http://localhost", body?: string) => new NextRequest(url, { method: "POST", body });
beforeEach(() => {
 vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
 m.job.mockResolvedValue({ id: "job1" }); m.report.mockResolvedValue({ pdfUrl: "versioned" }); m.settings.mockResolvedValue({ strictClientAdminOnly: false });
});
it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]] as const)("generation denies %s before any job lookup or side effect", async (error, status) => {
 m.auth.mockRejectedValue(new Error(error));
 expect((await POST(req(), params)).status).toBe(status);
 expect(m.job).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled(); expect(m.notice).not.toHaveBeenCalled();
});
it("generation returns missing job before rendering", async () => {
 m.job.mockResolvedValue(null);
 expect((await POST(req(), params)).status).toBe(404); expect(m.generate).not.toHaveBeenCalled();
});
it.each([["http://localhost?themeId=query-theme", '{"themeId":"body-theme"}', "query-theme"], ["http://localhost", '{"themeId":"body-theme"}', "body-theme"], ["http://localhost", undefined, undefined]] as const)("generation renders requested job/theme via %s", async (url, body, theme) => {
 const response = await POST(req(url, body), params);
 expect(m.auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
 expect(m.job.mock.calls[0][0].where).toEqual({ id: "job1" }); expect(m.generate).toHaveBeenCalledWith("job1", theme);
 expect(await response.json()).toMatchObject({ ok: true, report: { pdfUrl: "versioned" }, autoShare: { sent: false, recipients: [] } });
 expect(m.notice).not.toHaveBeenCalled();
});
it("strict communication policy records manual-share notice without claiming delivery", async () => {
 m.settings.mockResolvedValue({ strictClientAdminOnly: true });
 const response = await POST(req(), params);
 expect(await response.json()).toMatchObject({ autoShare: { sent: false, error: "Auto-send disabled by admin communication policy." } });
 expect(m.notice).toHaveBeenCalledWith({ data: expect.objectContaining({ body: expect.stringContaining("job1"), subject: "Report generated (manual client share required)" }) });
});
it("generation failure returns error without publishing success or queueing share notice", async () => {
 m.generate.mockRejectedValue(new Error("Report generation was superseded"));
 const response = await POST(req(), params);
 expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "Report generation was superseded" });
 expect(m.report).not.toHaveBeenCalled(); expect(m.notice).not.toHaveBeenCalled();
});
