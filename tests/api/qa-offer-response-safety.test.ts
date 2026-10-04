// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({role:vi.fn(),transaction:vi.fn(),offer:vi.fn(),offerUpdate:vi.fn(),job:vi.fn(),jobUpdate:vi.fn(),assignUpdate:vi.fn(),upsert:vi.fn(),notify:vi.fn(),raw:vi.fn()}));
vi.mock("@/lib/auth/session",()=>({requireRole:m.role}));
vi.mock("@/lib/db",()=>({db:{$transaction:m.transaction}}));
vi.mock("@/lib/notifications/admin-alerts",()=>({notifyAdminsByPush:m.notify}));
vi.mock("@/lib/qa/rework-invariants",()=>({guardInvariant:async(fn:()=>void)=>fn(),assertReworkInvoiceablePayee:vi.fn()}));
import { POST } from "@/app/api/cleaner/rework-offers/[assignmentId]/respond/route";
let committed=false;
const run=(accept:boolean)=>POST(new Request("http://localhost",{method:"POST",body:JSON.stringify({accept})}) as any,{params:{assignmentId:"offer"}});
beforeEach(()=>{
 vi.resetAllMocks();committed=false;m.role.mockResolvedValue({user:{id:"cleaner"}});m.offer.mockResolvedValue({id:"offer",jobId:"original",reworkOfferStatus:"OFFERED",reworkOfferExpiresAt:new Date(Date.now()+60000)});m.job.mockResolvedValue({id:"rw",status:"OFFERED"});m.raw.mockResolvedValue([{status:"OFFERED"}]);m.notify.mockImplementation(async()=>{expect(committed).toBe(true)});
 m.transaction.mockImplementation(async fn=>{const result=await fn({$executeRaw:vi.fn(),$queryRaw:m.raw,qaAssignment:{findUnique:m.offer,update:m.offerUpdate},jobAssignment:{findFirst:vi.fn(async()=>({userId:"cleaner"})),updateMany:m.assignUpdate,upsert:m.upsert},job:{findFirst:m.job,update:m.jobUpdate},auditLog:{create:vi.fn(async()=>({}))}});committed=true;return result;});
});
it("decline atomically removes cleaner assignment and releases child",async()=>{
 expect((await run(false)).status).toBe(200);expect(m.assignUpdate).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({responseStatus:"DECLINED",removedAt:expect.any(Date)})}));expect(m.jobUpdate).toHaveBeenCalledWith({where:{id:"rw"},data:{status:"UNASSIGNED"}});expect(m.upsert).not.toHaveBeenCalled();expect(m.notify).toHaveBeenCalledTimes(1);
});
it("explicit acceptance assigns the pending child once",async()=>{
 expect((await run(true)).status).toBe(200);expect(m.offerUpdate).toHaveBeenCalledWith({where:{id:"offer"},data:{reworkOfferStatus:"ACCEPTED"}});expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({update:expect.objectContaining({responseStatus:"ACCEPTED"})}));
});
it("concurrent prior response is rechecked behind the parent lock",async()=>{
 m.offer.mockResolvedValueOnce({id:"offer",jobId:"original",reworkOfferStatus:"OFFERED"}).mockResolvedValue({id:"offer",jobId:"original",reworkOfferStatus:"DECLINED"});expect((await run(true)).status).toBe(409);expect(m.jobUpdate).not.toHaveBeenCalled();expect(m.notify).not.toHaveBeenCalled();
});
it("missing child cannot produce accepted success",async()=>{
 m.job.mockResolvedValue(null);expect((await run(true)).status).toBe(400);expect(m.offerUpdate).not.toHaveBeenCalled();expect(m.notify).not.toHaveBeenCalled();
});
it("expired offer records expiry and rejects acceptance without assigning work",async()=>{m.offer.mockResolvedValue({id:"offer",jobId:"original",reworkOfferStatus:"OFFERED",reworkOfferExpiresAt:new Date(Date.now()-1000)});m.offerUpdate.mockResolvedValue({id:"offer"});const response=await run(true);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({status:"EXPIRED"});expect(m.offerUpdate).toHaveBeenCalledWith({where:{id:"offer"},data:{reworkOfferStatus:"EXPIRED"}});expect(m.jobUpdate).not.toHaveBeenCalled();expect(m.upsert).not.toHaveBeenCalled();expect(m.notify).not.toHaveBeenCalled();});
