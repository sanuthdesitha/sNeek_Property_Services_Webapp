// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), assignment: vi.fn(), cleaners: vi.fn(), template: vi.fn(), job: vi.fn(), latest: vi.fn(), laundry: vi.fn(), review: vi.fn(), createReview: vi.fn(), createSubmission: vi.fn(), assignmentUpdate: vi.fn(), jobUpdate: vi.fn(), audit: vi.fn(), settings: vi.fn(), rework: vi.fn(), transaction: vi.fn(), enqueue: vi.fn(), process: vi.fn(), notify: vi.fn(), score: vi.fn(), primary: vi.fn(), lock: vi.fn(), createCase: vi.fn(), offerNotify: vi.fn(), transfer: vi.fn(), rotate: vi.fn(), resolve:vi.fn(), assignmentRows:vi.fn(), overrides:vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/db", () => ({ db: { jobAssignment: { findMany: m.cleaners, findFirst: m.primary }, qaAssignment: { findFirst: m.assignment,findMany:m.assignmentRows },mediaOverrideRequest:{findMany:m.overrides}, qaFormTemplate: { findUnique: m.template }, job: { findUnique: m.job }, formSubmission: { findFirst: m.latest }, laundryTask: { findUnique: m.laundry }, qAReview: { findFirst: m.review }, $transaction: m.transaction } }));
vi.mock("@/lib/qa/templates", () => ({ scoreQaSubmission: m.score }));
vi.mock("@/lib/qa/template-resolution", () => ({resolveQaTemplate:m.resolve}));
vi.mock("@/lib/notifications/accountability", () => ({ notifyQaResultToCleaner: m.notify, notifyReworkOfferToCleaner:m.offerNotify }));
vi.mock("@/lib/qa/rework-jobs", () => ({ createReworkJobFromFailure: m.rework }));
vi.mock("@/lib/qa/rework-transfers", () => ({createQaReworkTransfer:m.transfer}));
vi.mock("@/lib/cases/service", () => ({createCase:m.createCase}));
vi.mock("@/lib/qa/annotation-composite", () => ({}));
vi.mock("@/lib/s3", () => ({publicUrl:(key:string)=>`https://invalid.local/${key}`}));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/accountability/patterns", () => ({}));
vi.mock("@/lib/accountability/rotation", () => ({applyJobRotationCompletion:m.rotate}));
vi.mock("@/lib/qa/reopen-facts", () => ({}));
vi.mock("@/lib/qa/report-followups", () => ({ enqueueQaReportFollowup: m.enqueue, processQaReportFollowups: m.process }));
import { POST, GET } from "@/app/api/qa/jobs/[id]/route";
let tx: any; let committed: boolean;
beforeEach(() => {
 vi.resetAllMocks(); committed = false;
 m.session.mockResolvedValue({ user: { id: "qa", role: "QA_INSPECTOR" } }); m.assignment.mockResolvedValue({ id: "a" }); m.cleaners.mockResolvedValue([]); m.primary.mockResolvedValue({ userId: "cleaner" });
 m.template.mockResolvedValue({ id: "t", schema: {} }); m.job.mockResolvedValue({ id: "j", status: "SUBMITTED", propertyId: "p", property: {} }); m.latest.mockResolvedValue(null); m.laundry.mockResolvedValue(null); m.review.mockResolvedValue(null);
 m.settings.mockResolvedValue({ accountability: { issueCategories: [] } }); m.score.mockReturnValue({ passed: false, score: 50, categoryScores: {} });
 m.createReview.mockResolvedValue({ id: "r" }); m.createSubmission.mockResolvedValue({ id: "s" }); m.assignmentUpdate.mockResolvedValue({ count: 1 });
 tx = { $executeRaw: m.lock, $queryRaw: vi.fn(async () => [{ status: "SUBMITTED", completedAt: null }]), jobAssignment: { findMany: m.cleaners, findFirst: m.primary }, qaAssignment: { findFirst: m.assignment, updateMany: m.assignmentUpdate }, qAReview: { findFirst: m.review, create: m.createReview }, qaFormSubmission: { create: m.createSubmission }, job: { update: m.jobUpdate }, auditLog: { create: m.audit } };
 m.notify.mockResolvedValue(undefined);m.offerNotify.mockResolvedValue(undefined);m.process.mockResolvedValue({reportReadySubmissionIds:["s"]});m.rework.mockResolvedValue("rw");m.transfer.mockResolvedValue({id:"transfer"});
 m.settings.mockResolvedValue({accountability:{issueCategories:[],rectification:{reworkOfferTtlMinutes:30}}});
 const receipts=new Map();tx.appSetting={findUnique:vi.fn(async({where})=>receipts.get(where.key)),create:vi.fn(async({data})=>{receipts.set(data.key,data);return data})};
 tx.jobAssignment.updateMany=vi.fn();tx.propertyStock={findMany:vi.fn(async()=>[{id:"stock",onHand:0,parLevel:2,reorderThreshold:1}])};tx.stockRun={create:vi.fn(async()=>({id:"stock-run"}))};
 tx.job.findUniqueOrThrow=vi.fn(async()=>({internalNotes:null}));tx.property={findUniqueOrThrow:vi.fn(async()=>({accessInfo:{doorCode:"preserved"}})),update:vi.fn()};
 m.transaction.mockImplementation(async fn => { const result = await fn(tx); committed = true; return result; });
});
it("mandatory rework failure aborts the QA transaction and never reports success or notifies", async () => {
 m.rework.mockRejectedValue(new Error("rework persistence failed"));
 const res = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ templateId: "t", assignmentId: "a", data: {}, tools: { rework: { enabled: true, flaggedAreas: [{ label: "Bathroom", photoKeys: ["qa/photo.jpg"] }], reason: "Clean missed" } } }) }) as any, { params: { id: "j" } });
 expect(res.status).toBe(400); expect((await res.json()).error).toBe("rework persistence failed"); expect(committed).toBe(false);
 expect(m.rework).toHaveBeenCalledWith(expect.objectContaining({ sourceReviewId: "r" }), tx); expect(m.enqueue).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled(); expect(m.process).not.toHaveBeenCalled();
});

it("a job invoiced during QA preparation remains locked", async () => {
 tx.$queryRaw.mockResolvedValue([{ status: "INVOICED", completedAt: new Date() }]);
 const res = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ templateId: "t", data: {} }) }) as any, { params: { id: "j" } });
 expect(res.status).toBe(400); expect(m.createReview).not.toHaveBeenCalled(); expect(m.jobUpdate).not.toHaveBeenCalled(); expect(committed).toBe(false);
});

it("QA damage case failure rolls back the inspection instead of returning partial success",async()=>{
 tx.appSetting={findUnique:vi.fn(async()=>null),create:vi.fn()};
 m.createCase.mockRejectedValue(new Error("repair create failed"));
 const res=await POST(new Request("http://localhost",{method:"POST",body:JSON.stringify({templateId:"t",data:{},tools:{damage:[{id:"damage-1",area:"Kitchen",description:"Broken bench"}]}})}) as any,{params:{id:"j"}});
 expect(res.status).toBe(400);expect((await res.json()).error).toBe("repair create failed");expect(committed).toBe(false);
 expect(m.createCase).toHaveBeenCalledWith(expect.objectContaining({clientVisible:false}),expect.objectContaining({transaction:tx}));expect(m.enqueue).not.toHaveBeenCalled();
});
it("QA stock request failure rolls back its review",async()=>{
 tx.appSetting={findUnique:vi.fn(async()=>null),create:vi.fn()};tx.propertyStock={findMany:vi.fn(async()=>[{id:"stock",onHand:0,parLevel:1,reorderThreshold:1}])};tx.stockRun={create:vi.fn(async()=>{throw new Error("stock create failed")})};
 const res=await POST(new Request("http://localhost",{method:"POST",body:JSON.stringify({templateId:"t",data:{},tools:{restock:[{propertyStockId:"stock",quantity:1}]}})}) as any,{params:{id:"j"}});
 expect(res.status).toBe(400);expect((await res.json()).error).toBe("stock create failed");expect(committed).toBe(false);expect(m.enqueue).not.toHaveBeenCalled();
});

const submitTools=(tools:any,extra:any={})=>POST(new Request("http://localhost",{method:"POST",body:JSON.stringify({templateId:"t",data:{},tools,...extra})}) as any,{params:{id:"j"}});
it("successful damage, inventory and next-clean actions commit before callbacks and report generation",async()=>{
 const effect=vi.fn(async()=>{expect(committed).toBe(true)});m.createCase.mockImplementation(async(_input,options)=>{expect(committed).toBe(false);expect(options.transaction).toBe(tx);options.afterCommit.push(effect);return{id:"case"}});
 m.process.mockImplementation(async()=>{expect(committed).toBe(true);return{reportReadySubmissionIds:["s"]}});
 const response=await submitTools({damage:[{id:"d",area:"Kitchen",description:"Scratch",photoKeys:["evidence"]}],restock:[{propertyStockId:"stock",quantity:3}],inventoryCount:[{propertyStockId:"stock",countedOnHand:1}],nextClean:[{kind:"SPECIAL_REQUEST",note:"Check cupboard"}]});
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({createdCaseIds:["case"],restockRunId:"stock-run",countRunId:"stock-run",reportPending:false});expect(effect).toHaveBeenCalledTimes(1);expect(tx.property.update.mock.calls[0][0].data.accessInfo).toMatchObject({doorCode:"preserved",qaNextClean:[expect.objectContaining({note:"Check cupboard"})]});expect(m.enqueue).toHaveBeenCalledWith(tx,{jobId:"j",submissionId:"s"});
});
it("repeated stable QA tool payload reuses case and stock IDs without repeating business effects",async()=>{
 m.createCase.mockResolvedValue({id:"case"});const tools={damage:[{id:"d",area:"Kitchen",description:"Scratch"}],restock:[{propertyStockId:"stock",quantity:3}]};
 expect((await submitTools(tools)).status).toBe(200);expect((await submitTools(tools)).status).toBe(200);expect(m.createCase).toHaveBeenCalledTimes(1);expect(tx.stockRun.create).toHaveBeenCalledTimes(1);
});
it("report upload failure keeps the committed QA response pending",async()=>{m.process.mockRejectedValue(new Error("storage offline"));const response=await submitTools({});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({reportPending:true});expect(committed).toBe(true);expect(m.enqueue).toHaveBeenCalled();});
it("offer-original persists pending child and assignment before notifying cleaner",async()=>{
 m.offerNotify.mockImplementation(async()=>{expect(committed).toBe(true)});
 const response=await submitTools({rework:{enabled:true,decision:"OFFER_ORIGINAL",flaggedAreas:[{label:"Bathroom",photoKeys:["proof"]}],reason:"Missed surfaces"}});
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({reworkJobId:"rw",reworkOffer:{assignmentId:"a",status:"OFFERED"}});expect(tx.jobAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{responseStatus:"PENDING",respondedAt:null}}));expect(m.offerNotify).toHaveBeenCalledTimes(1);
});
it("legacy flat rework areas cannot bypass photo evidence",async()=>{const response=await submitTools({rework:{enabled:true,areas:["Bathroom"],reason:"Missed"}});expect(response.status).toBe(400);expect(m.rework).not.toHaveBeenCalled();});
it("invalid inventory stock aborts review instead of silently dropping a line",async()=>{const response=await submitTools({inventoryCount:[{propertyStockId:"other-property",countedOnHand:1}]});expect(response.status).toBe(400);expect((await response.json()).error).toMatch(/invalid property stock/);expect(committed).toBe(false);expect(tx.stockRun.create).not.toHaveBeenCalled();});
it("QA self-rework transfer shares the review transaction and its postcommit queue",async()=>{
 m.transfer.mockImplementation(async(_input,options)=>{expect(options.transaction).toBe(tx);expect(committed).toBe(false);return{id:"transfer"}});
 const response=await submitTools({onSite:{minutes:30},rework:{enabled:true,decision:"QA_SELF",cleanerUserId:"cleaner",minutesFromCleaner:10,amountFromCleaner:5,flaggedAreas:[{label:"Bathroom",photoKeys:["proof"]}],reason:"Fixed missed area"}});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({reworkTransferId:"transfer"});expect(m.transfer).toHaveBeenCalledTimes(1);
});
it("amending a review preserves prior rework and transfer instead of duplicating either",async()=>{
 m.review.mockResolvedValue({id:"r"});tx.qAReview.update=vi.fn(async()=>({id:"r"}));tx.qaIssue={findMany:vi.fn(async()=>[])};tx.qaFormSubmission.findFirst=vi.fn(async()=>null);tx.job.count=vi.fn(async()=>1);tx.qaReworkTransfer={count:vi.fn(async()=>1)};
 const response=await submitTools({rework:{enabled:true,cleanerUserId:"cleaner",minutesFromCleaner:10,flaggedAreas:[{label:"Bathroom",photoKeys:["proof"]}],reason:"Still missed"}},{reopenedReviewId:"r"});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({amended:true,reworkJobId:null,reworkTransferId:null,reworkBlockedReason:expect.any(String)});expect(m.rework).not.toHaveBeenCalled();expect(m.transfer).not.toHaveBeenCalled();
});
it("successful pass preserves locked completion timestamp and invokes rotation in the transaction",async()=>{
 const completedAt=new Date("2026-09-01");tx.$queryRaw.mockResolvedValue([{status:"COMPLETED",completedAt}]);m.score.mockReturnValue({passed:true,score:100,categoryScores:{}});const response=await submitTools({});expect(response.status).toBe(200);expect(m.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"COMPLETED",completedAt})}));expect(m.rotate).toHaveBeenCalledWith(tx,{jobId:"j",propertyId:"p"});
});

it.each([{assignedToId:"other",pickedUpById:null},{assignedToId:null,pickedUpById:"other"}])("GET denies foreign inspector ownership while resolving template read-only %j",async(assignment)=>{
 m.session.mockResolvedValue({user:{id:"qa",role:"CLEANER",heldRoles:["CLEANER","QA_INSPECTOR"]}});m.resolve.mockResolvedValue({id:"t",schema:{}});m.assignmentRows.mockResolvedValue([assignment]);m.overrides.mockResolvedValue([]);
 const response=await GET(new Request("http://localhost") as any,{params:{id:"j"}});expect(response.status).toBe(403);expect((await response.json()).error).toMatch(/another inspector/);expect(m.resolve).toHaveBeenCalledWith("j");expect(m.transaction).not.toHaveBeenCalled();
});
it("authorized preview POST provisions template and uses its stored identity",async()=>{
 m.resolve.mockResolvedValue({id:"persisted-template",schema:{}});const response=await submitTools({},{templateId:"preview:j"});expect(response.status).toBe(200);expect(m.resolve).toHaveBeenCalledWith("j",true);expect(m.createSubmission).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({templateId:"persisted-template"})}));
});
it("offer persistence failure aborts QA without notifying cleaner",async()=>{
 tx.jobAssignment.updateMany.mockRejectedValue(new Error("offer assignment unavailable"));const response=await submitTools({rework:{enabled:true,decision:"OFFER_ORIGINAL",flaggedAreas:[{label:"Bathroom",photoKeys:["proof"]}],reason:"Missed"}});expect(response.status).toBe(400);expect((await response.json()).error).toBe("offer assignment unavailable");expect(committed).toBe(false);expect(m.offerNotify).not.toHaveBeenCalled();expect(m.enqueue).not.toHaveBeenCalled();
});
it("transfer persistence failure aborts QA and leaves report unqueued",async()=>{
 m.transfer.mockRejectedValue(new Error("transfer unavailable"));const response=await submitTools({onSite:{minutes:30},rework:{enabled:true,cleanerUserId:"cleaner",minutesFromCleaner:10,flaggedAreas:[{label:"Bathroom",photoKeys:["proof"]}],reason:"Missed"}});expect(response.status).toBe(400);expect((await response.json()).error).toBe("transfer unavailable");expect(committed).toBe(false);expect(m.enqueue).not.toHaveBeenCalled();
});
it("transfer-only amendment blocker preserves existing financial claim and gives its specific reason",async()=>{
 m.review.mockResolvedValue({id:"r"});tx.qAReview.update=vi.fn(async()=>({id:"r"}));tx.qaIssue={findMany:vi.fn(async()=>[])};tx.qaFormSubmission.findFirst=vi.fn(async()=>null);tx.job.count=vi.fn(async()=>0);tx.qaReworkTransfer={count:vi.fn(async()=>1)};
 const response=await submitTools({rework:{enabled:true,cleanerUserId:"cleaner",minutesFromCleaner:10,flaggedAreas:[{label:"Bathroom",photoKeys:["proof"]}],reason:"Missed"}},{reopenedReviewId:"r"});expect(response.status).toBe(200);expect((await response.json()).reworkBlockedReason).toMatch(/time\/pay transfer already exists/);expect(m.transfer).not.toHaveBeenCalled();
});
it("next-clean property write failure aborts QA and does not report saved instructions",async()=>{
 tx.property.update.mockRejectedValue(new Error("property write unavailable"));const response=await submitTools({nextClean:[{kind:"SPECIAL_REQUEST",note:"Check cupboard"}]});expect(response.status).toBe(400);expect((await response.json()).error).toBe("property write unavailable");expect(committed).toBe(false);expect(m.enqueue).not.toHaveBeenCalled();
});
