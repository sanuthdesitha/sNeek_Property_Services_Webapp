// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/client/jobs/[id]/route";
const mocks = vi.hoisted(() => ({ portal: vi.fn(), job: vi.fn(), progress: vi.fn() }));
vi.mock("@/lib/auth/client-portal", () => ({ requireClientPortal: mocks.portal, propertyScopeWhere: (p: any) => ({ clientId: p.clientId, ...(p.propertyIds ? { id: { in: p.propertyIds } } : {}) }) }));
vi.mock("@/lib/db", () => ({ db: { job: { findFirst: mocks.job } } }));
vi.mock("@/lib/jobs/progress", () => ({ computeJobProgressPercent: mocks.progress }));
const portal = () => ({ actor: "VA", clientId: "client", propertyIds: ["allowed"], permissions: { reports: false, invoicesView: false }, visibility: { showCleanerNames: false, showReports: true, showReportDownloads: true, showLiveProgress: false, showFinanceDetails: true, showJobs: true, showLaundryUpdates: true, showLaundryCosts: false }, settings: {} });
const job = () => ({ id: "job", status: "EN_ROUTE", scheduledDate: new Date("2026-09-13T00:00:00Z"), property: { latitude: 1, longitude: 2, showCleanerContactToClient: true }, cleanerLocationPings: [{ lat: 3, lng: 4, accuracy: 5, heading: 6, speed: 7, timestamp: new Date() }], assignments: [{ isPrimary: true, user: { id: "cleaner", name: "Private name", image: "image", phone: "private phone" } }], report: { id: "report", clientVisible: false, pdfUrl: "private report" }, invoiceLines: [{ id: "invoice" }], laundryTask: { id: "laundry", confirmations: [{ id: "confirmation", notes: '{"totalPrice":999,"note":"Private"}', laundryReady: true }] }, auditLogs: [{ id: "audit", action: "job.updated", user: { name: "Private name" } }] });
const request = () => GET(new Request("http://localhost/api/client/jobs/job"), { params: { id: "job" } });
beforeEach(() => { vi.resetAllMocks(); mocks.portal.mockResolvedValue(portal()); mocks.job.mockResolvedValue(job()); mocks.progress.mockResolvedValue(42); });
describe("client job privacy projection", () => {
  it.each(["EN_ROUTE", "IN_PROGRESS", "CANCELLED"])("does not release reports before completed status (%s)", async (status) => {
    const j = job(); j.status = status; j.report.clientVisible = true; mocks.job.mockResolvedValue(j); mocks.portal.mockResolvedValue({ ...portal(), actor: "CLIENT" }); expect((await (await request()).json()).report).toBeNull();
  });
  it("releases invoiced job reports under existing report policy", async () => {
    const j = job(); j.status = "INVOICED"; j.report.clientVisible = true; mocks.job.mockResolvedValue(j); mocks.portal.mockResolvedValue({ ...portal(), actor: "CLIENT" }); expect((await (await request()).json()).report).toEqual(j.report);
  });
  it("denies jobs module before reading any job", async () => {
    const p = portal(); p.visibility.showJobs = false; mocks.portal.mockResolvedValue(p);
    expect((await request()).status).toBe(403); expect(mocks.job).not.toHaveBeenCalled();
  });
  it("hides laundry or its unstructured costs while preserving confirmation shape", async () => {
    const p = portal(); mocks.portal.mockResolvedValue(p);
    expect((await (await request()).json()).laundryTask.confirmations[0]).toEqual({ id: "confirmation", notes: null, laundryReady: true });
    p.visibility.showLaundryCosts = true;
    expect((await (await request()).json()).laundryTask).toEqual(job().laundryTask);
    p.visibility.showLaundryUpdates = false;
    expect((await (await request()).json()).laundryTask).toBeNull();
  });
  it("preserves absent laundry", async () => { mocks.job.mockResolvedValue({ ...job(), laundryTask: null }); expect((await (await request()).json()).laundryTask).toBeNull(); });
  it("filters entire mixed-property invoices, draft and void invoices before projection", async () => {
    await request(); expect(mocks.job.mock.calls[0][0].select.invoiceLines.where).toEqual({ invoice: {
      clientId: "client", status: { notIn: ["DRAFT", "VOID"] },
      lines: { some: {}, every: { job: { property: { clientId: "client", id: { in: ["allowed"] } } } } },
    } });
  });
  it.each(["CLIENT", "VA"])("hides invoice lines when finance visibility is off for %s", async (actor) => {
    const p = portal(); p.actor = actor; p.permissions.invoicesView = true; p.visibility.showFinanceDetails = false; mocks.portal.mockResolvedValue(p);
    expect((await (await request()).json()).invoiceLines).toEqual([]);
  });
  it("keeps arrival projection but removes raw GPS, hidden staff, unreleased reports and ungranted invoices", async () => {
    const response = await request(); const body = await response.json();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).not.toHaveProperty("cleanerLocationPings");
    expect(body.liveTrip).toMatchObject({ cleanerLat: 3, cleanerLng: 4, propertyLat: 1 });
    expect(body.assignments).toEqual([]); expect(body.auditLogs[0]).toMatchObject({ id: "audit", user: null });
    expect(body.report).toBeNull(); expect(body.invoiceLines).toEqual([]); expect(body.progressPercent).toBeNull();
    expect(mocks.progress).not.toHaveBeenCalled();
    expect(mocks.job.mock.calls[0][0].where).toEqual({ id: "job", property: { clientId: "client", id: { in: ["allowed"] } } });
  });
  it.each(["CLIENT", "VA"])("preserves released report and invoice shapes with grants for %s", async (actor) => {
    const p = portal(); p.actor = actor; p.permissions = { reports: true, invoicesView: true }; p.visibility.showCleanerNames = true; p.visibility.showLiveProgress = true;
    const j = job(); j.report.clientVisible = true; j.status = "COMPLETED"; mocks.portal.mockResolvedValue(p); mocks.job.mockResolvedValue(j);
    const body = await (await request()).json(); expect(body.report).toEqual(j.report); expect(body.invoiceLines).toEqual(j.invoiceLines); expect(body.assignments).toEqual(j.assignments); expect(body.auditLogs).toEqual(j.auditLogs); expect(body.progressPercent).toBe(42);
  });
  it("clients do not need VA grants, but portal report visibility still applies", async () => {
    const p = portal(); p.actor = "CLIENT"; const j = job(); j.report.clientVisible = true; j.status = "COMPLETED"; mocks.portal.mockResolvedValue(p); mocks.job.mockResolvedValue(j);
    expect((await (await request()).json()).report).toEqual(j.report);
    p.visibility.showReports = false; expect((await (await request()).json()).report).toBeNull();
  });
  it("removes report downloads and cleaner contact independently", async () => {
    const p = portal(); p.permissions.reports = true; p.visibility.showCleanerNames = true; p.visibility.showReportDownloads = false;
    const j = job(); j.report.clientVisible = true; j.status = "COMPLETED"; j.property.showCleanerContactToClient = false; mocks.portal.mockResolvedValue(p); mocks.job.mockResolvedValue(j);
    const body = await (await request()).json(); expect(body.report.pdfUrl).toBeNull(); expect(body.assignments[0].user).not.toHaveProperty("phone"); expect(body.assignments[0].user.name).toBe("Private name");
  });
  it.each(["IN_PROGRESS", "COMPLETED", "INVOICED", "CANCELLED"])("never releases GPS outside EN_ROUTE (%s)", async (status) => {
    mocks.job.mockResolvedValue({ ...job(), status }); const body = await (await request()).json(); expect(body.liveTrip).toBeNull(); expect(body).not.toHaveProperty("cleanerLocationPings");
  });
  it.each(["stale", "future", "absent"])("does not advertise %s ping as live", async (kind) => {
    const j = job(); j.cleanerLocationPings = kind === "absent" ? [] : [{ ...j.cleanerLocationPings[0], timestamp: new Date(Date.now() + (kind === "stale" ? -121000 : 60000)) }]; mocks.job.mockResolvedValue(j);
    const body = await (await request()).json(); expect(body.liveTrip).toEqual({ cleanerLat: null, cleanerLng: null, accuracy: null, heading: null, speed: null, lastPingAt: null, propertyLat: 1, propertyLng: 2 });
  });
  it("keeps null report and null audit actor safe", async () => {
    mocks.portal.mockResolvedValue({ ...portal(), visibility: { ...portal().visibility, showCleanerNames: true }, permissions: { reports: true } }); mocks.job.mockResolvedValue({ ...job(), report: null, auditLogs: [{ user: null }] });
    expect((await (await request()).json()).report).toBeNull();
  });
  it.each([null, [], ["denied"]])("keeps ownership and scope in missing-job lookup (%j)", async (propertyIds) => {
    mocks.portal.mockResolvedValue({ ...portal(), propertyIds }); mocks.job.mockResolvedValue(null);
    expect((await request()).status).toBe(404); expect(mocks.job.mock.calls[0][0].where.property).toEqual({ clientId: "client", ...(propertyIds ? { id: { in: propertyIds } } : {}) }); expect(mocks.progress).not.toHaveBeenCalled();
  });
  it.each(["UNAUTHORIZED", "FORBIDDEN"])("maps %s without loading job", async (error) => {
    mocks.portal.mockRejectedValue(new Error(error)); expect((await request()).status).toBe(error === "UNAUTHORIZED" ? 401 : 403); expect(mocks.job).not.toHaveBeenCalled();
  });
  it.each([new Error("private database failure"), null])("masks internal errors", async (error) => {
    mocks.job.mockRejectedValue(error); const response = await request(); expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "Could not load job." });
  });
});
