// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => {
 process.env.S3_BUCKET_NAME = "test-only"; process.env.AWS_ACCESS_KEY_ID = "test-only"; process.env.AWS_SECRET_ACCESS_KEY = "test-only";
 return { get: vi.fn(), put: vi.fn() };
});
vi.mock("@/lib/s3", () => ({ s3: { getObject: m.get, putObject: m.put } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
import { getJobReportPdfBuffer, storedJobReportPdfKey } from "@/lib/reports/pdf";
beforeEach(() => { vi.clearAllMocks(); m.get.mockReturnValue({ promise: async () => ({ Body: Buffer.from("versioned pdf") }) }); });
it.each([
 ["https://storage.example.invalid/reports/job/report.pdf", "reports/job/report.pdf"],
 ["https://storage.example.invalid/prefix/reports/job/lease-one/report.pdf", "reports/job/lease-one/report.pdf"],
 ["https://storage.example.invalid/reports/other/report.pdf", null],
 ["https://storage.example.invalid/reports/job/extra/path/report.pdf", null],
 ["not-a-url", null], [null, null],
])("resolves the published PDF key %s", (url, key) => { expect(storedJobReportPdfKey({ pdfUrl: url }, "job")).toBe(key); });
it("fetches the versioned PDF rather than a stale fixed-key object", async () => {
 const pdf = await getJobReportPdfBuffer({ htmlContent: "html", pdfUrl: "https://storage.example.invalid/reports/job/lease-one/report.pdf" }, "job", { preferStored: true });
 expect(pdf?.toString()).toBe("versioned pdf");
 expect(m.get).toHaveBeenCalledWith({ Bucket: "test-only", Key: "reports/job/lease-one/report.pdf" }); expect(m.put).not.toHaveBeenCalled();
});
it("does not fetch a stale legacy object when the current report has no PDF", async () => {
 expect(await getJobReportPdfBuffer({ htmlContent: null, pdfUrl: null }, "job", { preferStored: true })).toBeNull();
 expect(m.get).not.toHaveBeenCalled(); expect(m.put).not.toHaveBeenCalled();
});

afterEach(() => vi.unstubAllGlobals());
it("falls back only to the published URL when its bucket object is unavailable", async () => {
 const url = "https://storage.example.invalid/reports/job/current-lease/report.pdf";
 m.get.mockReturnValue({ promise: async () => { throw new Error("missing object"); } });
 const fetch = vi.fn().mockResolvedValue(new Response("current URL pdf"));
 vi.stubGlobal("fetch", fetch);
 const pdf = await getJobReportPdfBuffer({ htmlContent: null, pdfUrl: url }, "job", { preferStored: true });
 expect(pdf?.toString()).toBe("current URL pdf");
 expect(fetch.mock.calls[0][0]).toBe(url);
 expect(m.get).toHaveBeenCalledTimes(1);
 expect(m.put).not.toHaveBeenCalled();
});
it("returns no PDF when the published object and URL are unavailable", async () => {
 m.get.mockReturnValue({ promise: async () => ({ Body: undefined }) });
 vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status: 404 })));
 expect(await getJobReportPdfBuffer({ htmlContent: null, pdfUrl: "https://storage.example.invalid/reports/job/current-lease/report.pdf" }, "job", { preferStored: true })).toBeNull();
 expect(m.get).toHaveBeenCalledTimes(1);
 expect(m.put).not.toHaveBeenCalled();
});
