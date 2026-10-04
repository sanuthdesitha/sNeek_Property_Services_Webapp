// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ db: {} as any, qa: vi.fn(), number: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/qa/authority", () => ({ getAuthoritativeQaReview: m.qa }));
vi.mock("@/lib/jobs/job-number", () => ({ reserveJobNumber: m.number }));
import { DEEP_CLEAN_PLAN_PREFIX, readDeepCleanPlan, verifyDeepCleanBaseline, planDueDeepCleanDrafts, scheduleDeepCleanProposal, listDeepCleanProposals } from "@/lib/properties/deep-clean-planning";
import { parseJobInternalNotes, serializeJobInternalNotes } from "@/lib/jobs/meta";
const now = new Date("2026-10-05T01:00:00Z");
let value: any, job: any, tx: any;
const verify = (revision = 0, at = now) => verifyDeepCleanBaseline({ propertyId: "p", jobId: "done", revision, reviewNote: "Reviewed room coverage and submitted photographs", evidenceReviewed: true }, "owner", at);
const schedule = (revision = value.revision, date = "2026-10-06", at = now) => scheduleDeepCleanProposal({ propertyId: "p", proposalId: value.proposal.id, revision, date }, "owner", at);
beforeEach(() => {
 vi.clearAllMocks(); value = null;
 job = { id: "done", jobNumber: "JOB-1", propertyId: "p", jobType: "DEEP_CLEAN", status: "COMPLETED", completedAt: new Date("2026-07-05T01:00:00Z"), internalNotes: null, isRework: false, formSubmissions: [{ id: "s", media: [{ s3Key: "proof.jpg" }] }] };
 tx = {
  $queryRaw: vi.fn(), property: { findUnique: vi.fn().mockResolvedValue({ id: "p", name: "Home", isActive: true }), findMany: vi.fn().mockResolvedValue([{ id: "p", name: "Home" }]) },
  appSetting: { findUnique: vi.fn().mockImplementation(async () => value ? { value: structuredClone(value) } : null), upsert: vi.fn().mockImplementation(async (args) => { value = structuredClone(args.update.value); return { value }; }), findMany: vi.fn().mockImplementation(async () => value ? [{ key: `${DEEP_CLEAN_PLAN_PREFIX}p`, value: structuredClone(value) }] : []) },
  job: { findUnique: vi.fn().mockImplementation(async () => job), findMany: vi.fn().mockImplementation(async () => [job]), create: vi.fn().mockResolvedValue({ id: "draft" }) }, auditLog: { create: vi.fn() },
 };
 Object.assign(m.db, tx, { $transaction: vi.fn().mockImplementation(async fn => fn(tx)) }); m.qa.mockResolvedValue({ id: "qa", passed: true }); m.number.mockResolvedValue("JOB-NEW");
});
it("unknown history remains unknown and read-only; evidence candidates are not verification", async () => {
 const result = await readDeepCleanPlan("p", now);
 expect(result.plan.baseline).toBeNull(); expect(result.baselineValid).toBe(false); expect(result.candidates[0].hasProof).toBe(true);
 expect(tx.appSetting.upsert).not.toHaveBeenCalled(); expect(tx.job.create).not.toHaveBeenCalled();
 expect(await planDueDeepCleanDrafts({ now })).toMatchObject({ scanned: 0, created: 0 });
});
it("explicit review creates only an undated proposal at the Sydney calendar anniversary", async () => {
 const plan = await verify(); expect(plan.baseline).toMatchObject({ completedDay: "2026-07-05", dueDay: "2026-10-05", verifiedBy: "owner", qaReviewId: "qa" });
 expect(plan.proposal).toMatchObject({ status: "NEEDS_SCHEDULING", dueDay: "2026-10-05", scheduledDay: null, jobId: null });
 expect(tx.job.create).not.toHaveBeenCalled(); expect(m.number).not.toHaveBeenCalled(); expect(tx.auditLog.create).toHaveBeenCalledOnce();
 expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ userId: "owner" }); expect(tx.auditLog.create.mock.calls[0][0].data.after).not.toHaveProperty("automation");
});
it("requires explicit reviewed attestation and note before touching storage", async () => {
 await expect(verifyDeepCleanBaseline({ propertyId: "p", jobId: "done", revision: 0, reviewNote: "", evidenceReviewed: false } as any, "owner", now)).rejects.toThrow(); expect(m.db.$transaction).not.toHaveBeenCalled();
});
it.each([
 { status: "SUBMITTED" }, { isRework: true }, { jobType: "GENERAL_CLEAN" }, { propertyId: "other" }, { completedAt: null }, { completedAt: new Date("2027-01-01") }, { internalNotes: serializeJobInternalNotes({ isDraft: true }) },
])("rejects nonqualifying baseline %j", async patch => { Object.assign(job, patch); await expect(verify()).rejects.toMatchObject({ code: "BASELINE_INVALID" }); expect(tx.appSetting.upsert).not.toHaveBeenCalled(); });
it.each([{ submissions: [] }, { submissions: [{ id: "s", media: [{ s3Key: " " }, { s3Key: null }] }] }])("requires submitted proof, not just a deep-clean label %j", async ({ submissions }) => {
 job.formSubmissions = submissions; await expect(verify()).rejects.toMatchObject({ code: "PROOF_REQUIRED" });
});
it("authoritative QA fail blocks verification; missing QA requires explicit office attestation", async () => {
 m.qa.mockResolvedValueOnce({ id: "qa", passed: false }); await expect(verify()).rejects.toMatchObject({ code: "QA_FAILED" });
 m.qa.mockResolvedValue(null); expect((await verify()).baseline?.qaReviewId).toBeNull();
});
it("worker reaches due day then deduplicates repeated scans without creating jobs", async () => {
 job.completedAt = new Date("2026-08-01T01:00:00Z"); await verify(); expect(value.proposal).toBeNull();
 expect(await planDueDeepCleanDrafts({ now })).toMatchObject({ created: 0, existing: 1 });
 const due = new Date("2026-10-31T13:00:00Z"); // Sydney Nov1 midnight, DST
 expect(await planDueDeepCleanDrafts({ now: due })).toMatchObject({ created: 1 }); const id = value.proposal.id;
 const audit = tx.auditLog.create.mock.calls.at(-1)[0].data;
 expect(audit).toMatchObject({ userId: "owner", action: "DEEP_CLEAN_PROPOSAL_CREATED", after: { automation: { actor: "deep-clean-planning-scheduler", authorizedBy: "owner", authorization: "verified-deep-clean-baseline" } } });
 expect(value).not.toHaveProperty("automation");
 expect(await planDueDeepCleanDrafts({ now: due })).toMatchObject({ created: 0, existing: 1 }); expect(value.proposal.id).toBe(id); expect(tx.job.create).not.toHaveBeenCalled();
});
it("end-of-month baseline uses three calendar months and clamps to last day", async () => {
 job.completedAt = new Date("2026-01-30T23:00:00Z"); expect((await verify()).baseline?.dueDay).toBe("2026-04-30");
});
it("corrected baseline defers existing proposal and reactivates same ID only on its new due date", async () => {
 await verify(); const id = value.proposal.id;
 job.completedAt = new Date("2026-09-05T01:00:00Z"); await verify(1);
 expect(value.proposal).toMatchObject({ id, status: "DEFERRED", dueDay: "2026-12-05" });
 await expect(schedule()).rejects.toMatchObject({ code: "NOT_DUE" }); expect((await listDeepCleanProposals(undefined, now)).proposals).toEqual([]);
 expect(await planDueDeepCleanDrafts({ now })).toMatchObject({ created: 0 });
 const due = new Date("2026-12-04T13:00:00Z"); expect(await planDueDeepCleanDrafts({ now: due })).toMatchObject({ created: 1 }); expect(value.proposal).toMatchObject({ id, status: "NEEDS_SCHEDULING" });
});
it("scheduling explicitly selected date creates one unassigned dated draft, never pricing or assignment writes", async () => {
 await verify(); const requestRevision = value.revision;
 const result = await schedule(); expect(result.jobId).toBe("draft");
 const data = tx.job.create.mock.calls[0][0].data;
 expect(data).toMatchObject({ status: "UNASSIGNED", jobType: "DEEP_CLEAN", scheduledDate: new Date("2026-10-05T13:00:00Z") }); expect(parseJobInternalNotes(data.internalNotes).isDraft).toBe(true);
 for (const key of ["fixedPrice", "assignments", "invoiceNote", "completedAt", "payrollRunId"]) expect(data).not.toHaveProperty(key);
 expect((await schedule(requestRevision)).jobId).toBe("draft"); expect(tx.job.create).toHaveBeenCalledOnce();
 await expect(schedule(value.revision, "2026-10-07")).rejects.toMatchObject({ code: "ALREADY_SCHEDULED" });
 expect(await planDueDeepCleanDrafts({ now })).toMatchObject({ created: 0 });
});
it.each(["date", "qa", "submission", "proof"])("changed verified evidence blocks scheduling and worker proposal: %s", async kind => {
 await verify();
 if (kind === "date") job.completedAt = new Date("2026-08-01");
 if (kind === "qa") m.qa.mockResolvedValue({ id: "qa-new", passed: false });
 if (kind === "submission") job.formSubmissions[0].id = "new-submission";
 if (kind === "proof") job.formSubmissions[0].media = [];
 await expect(schedule()).rejects.toMatchObject({ code: "BASELINE_CHANGED" }); expect(tx.job.create).not.toHaveBeenCalled();
 expect(await planDueDeepCleanDrafts({ now })).toMatchObject({ invalid: 1 }); expect((await readDeepCleanPlan("p", now)).baselineValid).toBe(false);
});
it("stale review and past-date scheduling are refused before job creation", async () => {
 await verify(); await expect(verify(0)).rejects.toMatchObject({ code: "REVISION_CONFLICT" }); await expect(schedule(0)).rejects.toMatchObject({ code: "REVISION_CONFLICT" }); await expect(schedule(1, "2026-10-04")).rejects.toMatchObject({ code: "PAST_DATE" }); expect(tx.job.create).not.toHaveBeenCalled();
});
it("job creation failure does not mark proposal consumed", async () => {
 await verify(); tx.job.create.mockRejectedValue(new Error("DB failure")); tx.appSetting.upsert.mockClear(); await expect(schedule()).rejects.toThrow("DB failure"); expect(tx.appSetting.upsert).not.toHaveBeenCalled(); expect(value.proposal.status).toBe("NEEDS_SCHEDULING");
});
it("new verified completion supersedes old undated proposal without deleting history", async () => {
 await verify(); job = { ...job, id: "new-completion", completedAt: new Date("2026-08-01") };
 await verifyDeepCleanBaseline({ propertyId: "p", jobId: job.id, revision: 1, reviewNote: "Reviewed new deep clean", evidenceReviewed: true }, "owner", now);
 expect(value.history).toEqual([expect.objectContaining({ status: "SUPERSEDED", baselineJobId: "done" })]); expect(value.proposal).toBeNull();
});
it("queue exposes undated owner work and worker offers keyset pagination", async () => {
 await verify(); expect((await listDeepCleanProposals(undefined, now)).proposals).toEqual([expect.objectContaining({ propertyId: "p", propertyName: "Home", baselineValid: true })]);
 const result = await planDueDeepCleanDrafts({ now, limit: 1, cursor: "prefix" }); expect(result.nextCursor).toBe(`${DEEP_CLEAN_PLAN_PREFIX}p`);
 expect(tx.appSetting.findMany.mock.calls.at(-1)[0]).toMatchObject({ where: { key: { startsWith: DEEP_CLEAN_PLAN_PREFIX, gt: "prefix" } }, take: 1 });
});

it("fails closed for malformed stored plans and inactive properties", async () => {
 value = { version: 9 };
 await expect(readDeepCleanPlan("p")).rejects.toMatchObject({code:"STORAGE_INVALID"});
 value=null;tx.property.findUnique.mockResolvedValue(null);
 await expect(readDeepCleanPlan("p")).rejects.toMatchObject({code:"PROPERTY_NOT_FOUND"});
 await expect(verify()).rejects.toMatchObject({code:"PROPERTY_NOT_FOUND"});
 expect(tx.appSetting.upsert).not.toHaveBeenCalled();
});
it("keeps no-QA evidence current and propagates database failures rather than treating them as invalid evidence", async () => {
 m.qa.mockResolvedValue(null);await verify();
 expect((await readDeepCleanPlan("p",now)).baselineValid).toBe(true);
 tx.job.findUnique.mockRejectedValue(new Error("Database unavailable"));
 await expect(readDeepCleanPlan("p",now)).rejects.toThrow("Database unavailable");
 expect(await planDueDeepCleanDrafts({now})).toMatchObject({errors:1,invalid:0});
});
it("does not replace a later verified baseline with older completion evidence",async()=>{
 await verify();job.completedAt=new Date("2026-06-01");
 await expect(verify(1)).rejects.toMatchObject({code:"OLDER_BASELINE"});
 expect(value.baseline.completedDay).toBe("2026-07-05");
});
it("retains a scheduled proposal in history when verifying a newer completion",async()=>{
 await verify();await schedule();job.id="new";job.completedAt=new Date("2026-08-01");
 await verifyDeepCleanBaseline({propertyId:"p",jobId:"new",revision:2,reviewNote:"Reviewed newer completion",evidenceReviewed:true},"owner",now);
 expect(value.history[0]).toMatchObject({status:"SCHEDULED",jobId:"draft"});
});
it("reverification preserves a due proposal and still requires valid audit identity",async()=>{
 await verify();await verify(1);expect(value.proposal.status).toBe("NEEDS_SCHEDULING");
 value.baseline.verifiedBy="";value.proposal=null;
 expect(await planDueDeepCleanDrafts({now})).toMatchObject({invalid:1,created:0});
});
it("refuses scheduling without a current proposal or baseline",async()=>{
 await expect(scheduleDeepCleanProposal({propertyId:"p",proposalId:"missing",revision:0,date:"2026-10-06"},"owner",now)).rejects.toMatchObject({code:"PROPOSAL_NOT_FOUND"});
 await verify();value.baseline=null;
 await expect(schedule()).rejects.toMatchObject({code:"BASELINE_CHANGED"});
 expect(await planDueDeepCleanDrafts({now})).toMatchObject({invalid:1});
 expect(tx.job.create).not.toHaveBeenCalled();
});
it("queues a full page with a continuation cursor and filters inactive property proposals",async()=>{
 await verify();
 tx.appSetting.findMany.mockResolvedValue(Array.from({length:100},(_,i)=>({key:`${DEEP_CLEAN_PLAN_PREFIX}p${i}`,value:{...structuredClone(value),propertyId:`p${i}`}})));
 tx.property.findMany.mockResolvedValue([]);
 const result=await listDeepCleanProposals("previous");
 expect(result).toEqual({proposals:[],nextCursor:`${DEEP_CLEAN_PLAN_PREFIX}p99`});
 expect(tx.appSetting.findMany.mock.calls.at(-1)[0].where.key.gt).toBe("previous");
});
