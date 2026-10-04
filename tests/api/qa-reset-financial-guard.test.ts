// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: vi.fn(), job: vi.fn(), jobs: vi.fn(), adjustments: vi.fn(), transfers: vi.fn(), transaction: vi.fn(), deletes: vi.fn(), lock: vi.fn(), claim: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.job }, $transaction: m.transaction } }));
import { POST } from "@/app/api/admin/jobs/[id]/qa-reset/route";
const run = (body: any) => POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }) as any, { params: { id: "j" } });
beforeEach(() => { vi.resetAllMocks(); m.role.mockResolvedValue({ user: { id: "admin" } }); m.job.mockResolvedValue({ id: "j", status: "COMPLETED" }); m.jobs.mockResolvedValue([{ id: "j", status: "COMPLETED", invoiceLines: [] }]); m.adjustments.mockResolvedValue(1); m.transfers.mockResolvedValue(0); m.claim.mockResolvedValue(null); m.transaction.mockImplementation(async fn => fn({ $executeRaw: m.lock, $queryRaw: m.lock, cleanerInvoiceSubmission: { findFirst: m.claim }, job: { findMany: m.jobs }, cleanerPayAdjustment: { count: m.adjustments }, qaReworkTransfer: { count: m.transfers }, qAReview: { deleteMany: m.deletes } })); });
it("requires explicit confirmation and meaningful reason", async () => {
 expect((await run({})).status).toBe(400); expect(m.transaction).not.toHaveBeenCalled();
});
it("pending or approved financial claims block reset before deletes", async () => {
 const response = await run({ confirm: true, reason: "Wrong inspection needs review" }); expect(response.status).toBe(400); expect((await response.json()).error).toMatch(/blocked by financial records/); expect(m.deletes).not.toHaveBeenCalled();
});

it("unpaid submitted cleaner invoice blocks destructive reset", async () => {
 m.adjustments.mockResolvedValue(0); m.claim.mockResolvedValue({id:"claim"});
 const response = await run({confirm:true,reason:"Wrong inspection needs review"});
 expect(response.status).toBe(400); expect(m.deletes).not.toHaveBeenCalled();
 expect(m.claim).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({status:{notIn:["VOID","CHANGES_REQUESTED"]}})}));
});
it.each([{payrollRunId:"payroll"},{cleanerPaidAt:new Date()},{invoiceLines:[{id:"invoice-line"}]},{status:"INVOICED"}])("each independent financial linkage blocks destructive reset %j",async(link)=>{m.adjustments.mockResolvedValue(0);m.jobs.mockResolvedValue([{id:"j",status:"COMPLETED",invoiceLines:[],...link}]);expect((await run({confirm:true,reason:"Inspect incorrect evidence"})).status).toBe(400);expect(m.deletes).not.toHaveBeenCalled();});
it("confirmed financially unlinked reset records reason and preserves already-started rework",async()=>{
 m.adjustments.mockResolvedValue(0);const deleteReviews=vi.fn();const updateAssignments=vi.fn();const audit=vi.fn();const updateJob=vi.fn();
 m.transaction.mockImplementation(async fn=>fn({$executeRaw:m.lock,$queryRaw:m.lock,cleanerInvoiceSubmission:{findFirst:m.claim},job:{findMany:vi.fn().mockResolvedValueOnce([{id:"j",status:"COMPLETED",invoiceLines:[]}]).mockResolvedValueOnce([{id:"started",status:"IN_PROGRESS"}]),update:updateJob},cleanerPayAdjustment:{count:m.adjustments},qaReworkTransfer:{count:m.transfers},qAReview:{findMany:vi.fn(async()=>[{id:"review"}]),deleteMany:deleteReviews},qaFormSubmission:{updateMany:vi.fn()},qaAssignment:{findMany:vi.fn(async()=>[{id:"assignment"}]),updateMany:updateAssignments},auditLog:{create:audit}}));
 const response=await run({confirm:true,reason:"Inspect incorrect evidence"});expect(response.status).toBe(200);expect(deleteReviews).toHaveBeenCalled();expect(updateAssignments).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"OPEN",pickedUpById:null,completedAt:null})}));expect(updateJob).toHaveBeenCalledWith({where:{id:"j"},data:{status:"QA_REVIEW",completedAt:null}});expect(audit).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({after:expect.objectContaining({reason:"Inspect incorrect evidence",startedReworksRemaining:1})})}));
});
