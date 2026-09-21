// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), assignment: vi.fn(), submission: vi.fn(), settings: vi.fn(), appSettings: vi.fn(), reviews: vi.fn(), changeScore: vi.fn(), changeJob: vi.fn(), update: vi.fn(), upsert: vi.fn(), audit: vi.fn(), raw: vi.fn(), transaction: vi.fn(), rating: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/ai/vision-settings", () => ({ getVisionSettings: m.settings }));
vi.mock("@/lib/ai/vision", () => ({ compareReferencePhotos: vi.fn() }));
vi.mock("@/lib/ai/images", () => ({ loadVisionImage: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.appSettings }));
vi.mock("@/lib/accountability/scoring", () => ({ ratingForScore: m.rating }));
vi.mock("@/lib/s3", () => ({ getPresignedDownloadUrl: async (key: string) => `signed:${key}` }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transaction, qaAssignment: { findFirst: m.assignment }, formSubmission: { findFirst: m.submission }, qAReview: { findMany: m.reviews } } }));
import { GET, POST } from "@/app/api/qa/jobs/[id]/photo-review/route";
import { photoSourceFingerprint } from "@/lib/ai/photo-review";
import { DEFAULT_VISION_SETTINGS } from "@/lib/ai/vision-settings-schema";
let submission: any; let review: any; let score: any; let session: any; let tx: any;
const approve = { action: "approve", analysisId: "analysis", reason: "Confirmed visible mess", findingIds: ["finding"], expectedReviewId: "qa", expectedScore: 90 };
const run = (body: any = approve) => POST(new Request("http://localhost/api/qa/jobs/job/photo-review", { method: "POST", body: JSON.stringify(body) }), { params: { id: "job" } });
beforeEach(() => {
 vi.resetAllMocks(); session = { user: { id: "inspector", role: "QA_INSPECTOR" } }; m.role.mockImplementation(async () => session); m.assignment.mockResolvedValue({ id: "assignment" });
 const settings = { ...DEFAULT_VISION_SETTINGS, comparisonEnabled: true }; m.settings.mockResolvedValue(settings); m.appSettings.mockResolvedValue({ accountability: { scoring: { criticalTriggersManagementReview: true } } }); m.rating.mockReturnValue("PASS");
 review = { id: "analysis", status: "READY", settings, reviewedAt: null, result: { totalPhotos: 1, observations: [{ mediaId: "photo", fieldId: "bath", fieldLabel: "Bath", assessment: "issue", summary: "Mess", findings: [{ id: "finding", mediaId: "photo", fieldId: "bath", fieldLabel: "Bath", description: "Mess", severity: "major", confidence: .95 }] }] } };
 submission = { id: "submission", job: { id: "job", status: "COMPLETED", completedAt: new Date(), property: {} }, laundryReady: false, data: { __templateSchema: { sections: [{ fields: [{ id: "bath", type: "photo", references: [{ kind: "image", storageKey: "form-references/admin/bath.jpg" }] }] }] } }, media: [{ id: "photo", fieldId: "bath", s3Key: "forms/job/photo", mediaType: "PHOTO" }], aiPhotoReview: review }; review.sourceFingerprint = photoSourceFingerprint(submission);
 score = { id: "qa", kind: "QA", reviewedById: "inspector", score: 90, rawScore: 90, updatedAt: new Date(), createdAt: new Date() }; m.reviews.mockImplementation(async () => [score]); m.submission.mockImplementation(async () => submission); m.changeScore.mockResolvedValue({ count: 1 }); m.update.mockImplementation(async ({ data }: any) => Object.assign(review, data)); m.upsert.mockResolvedValue({ status: "PENDING" });
 tx = { $executeRaw: m.raw, $queryRaw: m.raw, qaAssignment: { findFirst: m.assignment }, formSubmission: { findFirst: m.submission }, aiPhotoReview: { update: m.update, upsert: m.upsert, findFirst: vi.fn(async () => null) }, qAReview: { findMany: m.reviews, updateMany: m.changeScore }, qaIssue: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) }, job: { update: m.changeJob }, auditLog: { create: m.audit } }; m.transaction.mockImplementation(async callback => callback(tx));
});
it("approval changes score and job outcome inside one locked transaction and audits", async () => { expect((await run()).status).toBe(200); expect(m.changeScore.mock.calls[0][0]).toMatchObject({ where: { id: "qa", score: 90, updatedAt: score.updatedAt }, data: { score: 85, editedById: "inspector" } }); expect(m.changeJob).toHaveBeenCalledWith({ where: { id: "job" }, data: { status: "COMPLETED", completedAt: submission.job.completedAt } }); expect(m.audit).toHaveBeenCalledTimes(1); expect(m.raw.mock.calls.map(call => call[0].join("")).join(" ")).toContain('FROM "Job" WHERE "id" =  FOR UPDATE'); });
it("same approval retry never deducts twice; a different decision conflicts", async () => { expect((await run()).status).toBe(200); expect((await run()).status).toBe(200); expect(m.changeScore).toHaveBeenCalledTimes(1); expect((await run({ action: "dismiss", analysisId: "analysis", reason: "Different reason" })).status).toBe(409); });
it.each(["INVOICED"])("prevents score changes for %s jobs", async status => { submission.job.status = status; expect((await run()).status).toBe(409); expect(m.changeScore).not.toHaveBeenCalled(); });
it("assigned QA may adjust only their own authoritative QA review; admin may adjust it", async () => { score.reviewedById = "another"; expect((await run()).status).toBe(403); expect(m.changeScore).not.toHaveBeenCalled(); session.user.role = "ADMIN"; expect((await run()).status).toBe(200); });
it("assignment revocation and impersonation fail before mutations", async () => { m.assignment.mockResolvedValueOnce({ id: "old" }).mockResolvedValueOnce(null); expect((await run()).status).toBe(403); session.impersonation = { actorId: "admin" }; expect((await run()).status).toBe(403); expect(m.changeScore).not.toHaveBeenCalled(); });
it.each(["evidence", "reference", "laundry", "score", "cas", "new-submission"])("rejects stale %s", async kind => { if (kind === "evidence") submission.media[0].s3Key += "changed"; if (kind === "reference") submission.data.__templateSchema.sections[0].fields[0].references[0].storageKey += "changed"; if (kind === "laundry") submission.laundryReady = true; if (kind === "score") score.score = 80; if (kind === "cas") m.changeScore.mockResolvedValue({ count: 0 }); if (kind === "new-submission") submission.aiPhotoReview = null; expect((await run()).status).toBe(409); expect(m.changeJob).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled(); });
it("analyze queues and dismiss audits without changing scores", async () => { expect((await run({ action: "analyze" })).status).toBe(200); expect(m.upsert).toHaveBeenCalledTimes(1); expect((await run({ action: "dismiss", analysisId: "analysis", reason: "Photo is inconclusive" })).status).toBe(200); expect(m.changeScore).not.toHaveBeenCalled(); expect(m.changeJob).not.toHaveBeenCalled(); });
it("unknown persistence error is generic, never leaks internal errors", async () => { m.transaction.mockRejectedValue(new Error("postgres credential secret")); const response = await run(); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("secret"); });
it("GET scopes inspector and signs only actual submission/reference images", async () => { const response = await GET(new Request("http://localhost"), { params: { id: "job" } }); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ canApprove: true, scoreReview: { id: "qa", score: 90 }, photos: [{ mediaId: "photo", url: "signed:forms/job/photo", referenceUrls: ["signed:form-references/admin/bath.jpg"] }] }); m.assignment.mockResolvedValue(null); expect((await GET(new Request("http://localhost"), { params: { id: "job" } })).status).toBe(403); });


it("blocks duplicate scoring for an existing issue matching the field or evidence photo", async () => { tx.qaIssue.findFirst.mockResolvedValue({ id: "existing-issue" }); const response = await run(); expect(response.status).toBe(409); expect((await response.json()).error).toContain("deducting twice"); expect(tx.qaIssue.findFirst.mock.calls[0][0].where).toMatchObject({ qaReviewId: "qa", OR: [{ fieldId: { in: ["bath"] } }, { cleanerMediaIds: { array_contains: ["photo"] } }] }); expect(m.changeScore).not.toHaveBeenCalled(); });

it("a new analysis cannot deduct again from the same authoritative QA review", async () => {
 tx.aiPhotoReview.findFirst.mockResolvedValue({ id: "previous-analysis" });
 const response = await run(); expect(response.status).toBe(409); expect((await response.json()).error).toContain("already includes an approved photo deduction");
 expect(tx.aiPhotoReview.findFirst).toHaveBeenCalledWith({ where: { id: { not: "analysis" }, reviewedAt: { not: null }, submission: { jobId: "job" }, decision: { path: ["qaReviewId"], equals: "qa" } }, select: { id: true } });
 expect(m.changeScore).not.toHaveBeenCalled(); expect(m.changeJob).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
});
it("a different authoritative QA review can receive its own first approved deduction", async () => {
 score.id = "new-qa";
 tx.aiPhotoReview.findFirst.mockImplementation(async ({ where }: any) => where.decision.equals === "qa" ? { id: "previous-analysis" } : null);
 expect((await run({ ...approve, expectedReviewId: "new-qa" })).status).toBe(200);
 expect(m.changeScore.mock.calls[0][0].where.id).toBe("new-qa");
});
