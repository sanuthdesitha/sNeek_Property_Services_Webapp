// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ session: vi.fn(), report: vi.fn(), settings: vi.fn(), assignment: vi.fn(), user: vi.fn(), review: vi.fn(), qa: vi.fn(), damage: vi.fn(), clientDamage: vi.fn(), generate: vi.fn(), pdf: vi.fn(), jobs: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/db", () => ({ db: { jobAssignment: { findFirst: m.assignment }, user: { findUnique: m.user }, qAReview: { findFirst: m.review }, job: { findMany: m.jobs } } }));
vi.mock("@/lib/reports/access", () => ({ getStoredJobReport: m.report }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/reports/generator", () => ({ generateJobReport: m.generate }));
vi.mock("@/lib/reports/pdf", () => ({ getJobReportPdfBuffer: m.pdf, renderPdfFromHtml: m.pdf }));
vi.mock("@/lib/reports/qa-report", () => ({ buildQaReportHtml: m.qa }));
vi.mock("@/lib/reports/damage-report", () => ({ buildDamageReportHtml: m.damage }));
vi.mock("@/lib/damage/investigation", () => ({ getDamageInvestigationForClient: m.clientDamage }));
import { GET as cleaning } from "@/app/api/reports/[jobId]/download/route";
import { GET as qa } from "@/app/api/qa/jobs/[id]/report/route";
import { GET as damage } from "@/app/api/damage/[reportId]/report/route";
import { GET as jobs } from "@/app/api/jobs/route";
const req = () => new NextRequest("http://localhost/report?format=html");
beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "viewer", role: "MAINTENANCE", heldRoles: ["CLEANER", "MAINTENANCE"] } });
  m.report.mockResolvedValue({ htmlContent: "private", job: { property: { clientId: "other" } }, cleanerVisible: true });
  m.settings.mockResolvedValue({ clientPortalVisibility: { showReports: true, showReportDownloads: true } });
  m.qa.mockResolvedValue({ html: "internal", jobNumber: "JOB1" });
  m.damage.mockResolvedValue({ html: "internal" });
  m.jobs.mockResolvedValue([]);
});
it("rejects unrelated active hat on another cleaner's cleaning report", async () => {
  expect((await cleaning(req(), { params: { jobId: "other" } })).status).toBe(403);
  expect(m.assignment).toHaveBeenCalled();
});
it("rejects unrelated active hat on another cleaner's internal QA report", async () => {
  expect((await qa(req(), { params: { id: "other" } })).status).toBe(403);
  expect(m.qa).not.toHaveBeenCalled();
});
it("checks client ownership even while a held unrelated role is active", async () => {
  m.session.mockResolvedValue({ user: { id: "viewer", role: "CLEANER", heldRoles: ["CLIENT", "CLEANER"] } });
  m.user.mockResolvedValue({ clientId: "client1" });
  expect((await damage(req(), { params: { reportId: "other" } })).status).toBe(404);
  expect(m.damage).not.toHaveBeenCalled();
});
it("scopes job list to the admitted cleaner even with an unrelated active role", async () => {
  await jobs(new NextRequest("http://localhost/api/jobs?cleanerId=someone-else"));
  expect(m.jobs.mock.calls[0][0].where.assignments).toEqual({ some: { userId: "viewer", removedAt: null } });
});
it("never generates a missing report during GET", async () => {
  m.report.mockResolvedValue(null);
  expect((await cleaning(req(), { params: { jobId: "missing" } })).status).toBe(409);
  expect(m.generate).not.toHaveBeenCalled();
});
it("keeps an assigned cleaner on the safe QA audience while acting maintenance", async () => {
  m.assignment.mockResolvedValue({ id: "assignment" });
  expect((await qa(req(), { params: { id: "own" } })).status).toBe(200);
  expect(m.qa).toHaveBeenCalledWith("own", { mode: "cleanerSafe" });
});
it("respects hidden cleaner QA reports even for another active hat", async () => {
  m.assignment.mockResolvedValue({ id: "assignment" }); m.review.mockResolvedValue({ cleanerReportVisible: false });
  expect((await qa(req(), { params: { id: "own" } })).status).toBe(403);
  expect(m.qa).not.toHaveBeenCalled();
});
it("never invokes PDF persistent-refresh mode during download", async () => {
  m.assignment.mockResolvedValue({ id: "assignment" }); m.pdf.mockResolvedValue(Buffer.from("pdf"));
  expect((await cleaning(new NextRequest("http://localhost/report"), { params: { jobId: "own" } })).status).toBe(200);
  expect(m.pdf).toHaveBeenCalledWith(expect.anything(), "own", { preferStored: true });
});
it("keeps a valid client on the client damage audience", async () => {
  m.session.mockResolvedValue({ user: { id: "viewer", role: "CLEANER", heldRoles: ["CLIENT", "CLEANER"] } });
  m.user.mockResolvedValue({ clientId: "client1" }); m.clientDamage.mockResolvedValue({ id: "own" });
  expect((await damage(req(), { params: { reportId: "own" } })).status).toBe(200);
  expect(m.damage).toHaveBeenCalledWith("own", "CLIENT");
});
it("hides draft jobs from admitted cleaners but keeps them visible to office", async () => {
  const { serializeJobInternalNotes } = await import("@/lib/jobs/meta");
  m.jobs.mockResolvedValue([{ id: "draft", internalNotes: serializeJobInternalNotes({ isDraft: true }) }, { id: "live", internalNotes: null }]);
  const cleaner = await jobs(new NextRequest("http://localhost/api/jobs"));
  expect((await cleaner.json()).map((job: any) => job.id)).toEqual(["live"]);
  m.session.mockResolvedValue({ user: { id: "office", role: "ADMIN" } });
  const office = await jobs(new NextRequest("http://localhost/api/jobs"));
  expect((await office.json()).map((job: any) => job.id)).toEqual(["draft", "live"]);
});

it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403], ["lookup failed", 400]] as const)("report download preserves authorization/error status for %s", async (error, status) => {
 m.session.mockRejectedValue(new Error(error));
 expect((await cleaning(req(), { params: { jobId: "job" } })).status).toBe(status);
 expect(m.report).not.toHaveBeenCalled(); expect(m.pdf).not.toHaveBeenCalled();
});
it("allows client HTML for owned visible report while downloads remain disabled", async () => {
 m.session.mockResolvedValue({ user: { id: "viewer", role: "CLIENT" } });
 m.user.mockResolvedValue({ clientId: "own" });
 m.report.mockResolvedValue({ htmlContent: "own report", clientVisible: true, job: { property: { clientId: "own" } } });
 m.settings.mockResolvedValue({ clientPortalVisibility: { showReports: true, showReportDownloads: false } });
 expect(await (await cleaning(req(), { params: { jobId: "job" } })).text()).toBe("own report");
 expect((await cleaning(new NextRequest("http://localhost/report"), { params: { jobId: "job" } })).status).toBe(403);
 expect(m.pdf).not.toHaveBeenCalled();
});
it("does not expose a hidden cleaner report even to an assigned cleaner", async () => {
 m.assignment.mockResolvedValue({ jobId: "own" });
 m.report.mockResolvedValue({ htmlContent: "private", cleanerVisible: false });
 expect((await cleaning(req(), { params: { jobId: "own" } })).status).toBe(403);
 expect(m.pdf).not.toHaveBeenCalled();
});
it.each([null, new Error("renderer unavailable")])("PDF unavailability returns503 without invoking generation", async failure => {
 m.assignment.mockResolvedValue({ jobId: "own" });
 if (failure) m.pdf.mockRejectedValue(failure); else m.pdf.mockResolvedValue(null);
 expect((await cleaning(new NextRequest("http://localhost/report"), { params: { jobId: "own" } })).status).toBe(503);
 expect(m.generate).not.toHaveBeenCalled();
});
it("missing stored HTML returns404 without generation", async () => {
 m.assignment.mockResolvedValue({ jobId: "own" }); m.report.mockResolvedValue({ htmlContent: null, cleanerVisible: true });
 expect((await cleaning(req(), { params: { jobId: "own" } })).status).toBe(404);
 expect(m.generate).not.toHaveBeenCalled();
});
it("PDF failure without a message uses a safe actionable503 response", async () => {
 m.assignment.mockResolvedValue({ jobId: "own" }); m.pdf.mockRejectedValue({});
 const response = await cleaning(new NextRequest("http://localhost/report"), { params: { jobId: "own" } });
 expect(response.status).toBe(503);
 expect((await response.json()).error).toContain("PDF generation failed");
 expect(m.generate).not.toHaveBeenCalled();
});
