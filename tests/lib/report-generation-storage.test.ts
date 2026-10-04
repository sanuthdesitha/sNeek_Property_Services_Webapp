// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => {
 process.env.S3_BUCKET_NAME = "test-only"; process.env.S3_PUBLIC_BASE_URL = "https://storage.example.invalid";
 process.env.AWS_ACCESS_KEY_ID = "test-only"; process.env.AWS_SECRET_ACCESS_KEY = "test-only";
 return { lease: vi.fn(), upsert: vi.fn(), put: vi.fn(), job: vi.fn(), pdf: vi.fn() };
});
vi.mock("@/lib/reports/generation-lease", () => ({ withReportGeneration: m.lease }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.job } } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/s3", () => ({ s3: { putObject: m.put }, publicUrl: (key: string) => key }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({}) }));
vi.mock("@/lib/reports/report-view-model", () => ({ buildReportViewModel: () => ({}) }));
vi.mock("@/lib/reports/estate-template", () => ({ renderEstateReport: () => "<html>report</html>" }));
vi.mock("@/lib/reports/verification", () => ({ ensureReportVerification: async () => ({ code: "ABCDEFGH" }), formatVerificationCode: (code: string) => code }));
vi.mock("@/lib/app-url", () => ({ getAppBaseUrl: () => "" }));
vi.mock("@/lib/reports/pdf", () => ({ renderPdfFromHtml: m.pdf }));
import { generateJobReport, buildUnifiedJobTasksHtml } from "@/lib/reports/generator";
const updatedAt = new Date("2026-10-03T00:00:00Z");
beforeEach(() => {
 vi.resetAllMocks();
 m.job.mockResolvedValue({ id: "job", updatedAt, property: {}, scheduledDate: updatedAt, formSubmissions: [], qaReviews: [] });
 m.put.mockReturnValue({ promise: async () => ({}) }); m.pdf.mockResolvedValue(Buffer.from("pdf"));
 m.lease.mockImplementation(async (_id, run) => run({ storageId: "lease-one", publish: async (expected: Date, write: any) => { expect(expected).toEqual(updatedAt); await write({ report: { upsert: m.upsert } }); } }));
});
it("writes immutable generation objects and publishes only through the lease fence", async () => {
 await generateJobReport("job");
 expect(m.lease).toHaveBeenCalledWith("job", expect.any(Function));
 expect(m.put.mock.calls.map(call => call[0].Key)).toEqual(["reports/job/lease-one/report.html", "reports/job/lease-one/report.pdf"]);
 expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ s3Key: "reports/job/lease-one/report.html", pdfUrl: "https://storage.example.invalid/reports/job/lease-one/report.pdf" }) }));
});
it("a rejected stale generation never publishes or overwrites the fixed legacy objects", async () => {
 m.lease.mockImplementation(async (_id, run) => run({ storageId: "old-worker", publish: async () => { throw new Error("superseded"); } }));
 await expect(generateJobReport("job")).rejects.toThrow("superseded");
 expect(m.upsert).not.toHaveBeenCalled();
 expect(m.put.mock.calls.map(call => call[0].Key)).toEqual(["reports/job/old-worker/report.html", "reports/job/old-worker/report.pdf"]);
});
it("publishes HTML without a PDF pointer when PDF rendering fails", async () => {
 m.pdf.mockRejectedValue(new Error("no browser")); await generateJobReport("job");
 expect(m.upsert.mock.calls[0][0].update.pdfUrl).toBeNull();
 expect(m.put).toHaveBeenCalledTimes(1);
});

it("prints not-applicable special tasks neutrally with the reason and proof", () => {
 const result = buildUnifiedJobTasksHtml({ data: { __jobTasks: [{ title: "Water plants", decision: "NOT_APPLICABLE", note: "No live plants at this property", proofFieldId: "plant_proof" }] }, media: [{ id: "photo", fieldId: "plant_proof", mediaType: "PHOTO", url: "https://example.invalid/proof.jpg" }] }, true);
 expect(result.html).toContain("Not applicable"); expect(result.html).toContain("<strong>Reason:</strong>");
 expect(result.html).toContain("No live plants"); expect(result.html).toContain("https://example.invalid/proof.jpg");
 expect(result.html).not.toContain("#dcfce7"); expect(result.html).not.toContain("#166534"); expect(result.usedMediaIds.has("photo")).toBe(true);
});
