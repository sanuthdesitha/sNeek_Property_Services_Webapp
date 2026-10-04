// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({read:vi.fn(),locked:vi.fn(),lock:vi.fn(),archive:vi.fn(),remove:vi.fn(),update:vi.fn(),hide:vi.fn(),comment:vi.fn(),notice:vi.fn(),tx:vi.fn(),error:vi.fn()}));
vi.mock("@/lib/db",()=>({db:{damageReport:{findUnique:m.read},notification:{create:m.notice},$transaction:m.tx}}));
vi.mock("@/lib/logger",()=>({logger:{error:m.error}}));
import { voidDamageReport } from "@/lib/damage/void";
const input={reportId:"report",actorUserId:"admin",mode:"KEEP_AND_REOPEN" as const,reason:"Missing detail"};
beforeEach(()=>{vi.resetAllMocks();m.read.mockResolvedValue({id:"report",jobId:"job",reportedById:"cleaner",status:"SUBMITTED",items:[{id:"item",caseId:"case",photos:[{s3Key:"proof"}]}]});m.locked.mockResolvedValue({status:"SUBMITTED"});m.archive.mockResolvedValue({id:"void"});m.tx.mockImplementation(async fn=>fn({$executeRaw:m.lock,damageReport:{findUnique:m.locked,update:m.update},damageReportVoid:{create:m.archive},damageItem:{deleteMany:m.remove},issueTicket:{updateMany:m.hide},caseComment:{createMany:m.comment}}));});
it.each([null,{status:"DRAFT"}])("rejects a concurrent void before destructive writes",async state=>{
 m.locked.mockResolvedValue(state);await expect(voidDamageReport(input)).rejects.toThrow("DAMAGE_REPORT_NOT_SUBMITTED");expect(m.lock).toHaveBeenCalled();expect(m.archive).not.toHaveBeenCalled();expect(m.remove).not.toHaveBeenCalled();expect(m.notice).not.toHaveBeenCalled();
});
it("archives before clearing and notifies only after transaction completion",async()=>{
 let committed=false;const tx=m.tx.getMockImplementation()!;m.tx.mockImplementation(async fn=>{const result=await tx(fn);committed=true;return result;});m.notice.mockImplementation(async()=>{expect(committed).toBe(true)});
 await voidDamageReport({...input,mode:"CLEAR_AND_REDO"});
 expect(m.archive.mock.calls[0][0].data.archivedItems[0]).toMatchObject({id:"item",photos:[{s3Key:"proof"}]});
 expect(m.archive.mock.invocationCallOrder[0]).toBeLessThan(m.remove.mock.invocationCallOrder[0]);
 expect(m.update.mock.calls[0][0].data).toMatchObject({status:"DRAFT",clientVisible:false,acknowledgedAt:null});
 expect(m.comment.mock.calls[0][0].data[0]).toMatchObject({caseId:"case",isInternal:true});
 expect(m.notice.mock.calls[0][0].data.externalId).toContain("cases");
});
it("does not notify if transactional persistence fails",async()=>{m.archive.mockRejectedValue(new Error("write failed"));await expect(voidDamageReport(input)).rejects.toThrow("write failed");expect(m.remove).not.toHaveBeenCalled();expect(m.notice).not.toHaveBeenCalled();});
it("preserves successful reopen and evidence when notification fails",async()=>{m.notice.mockRejectedValue(new Error("queue failed"));expect(await voidDamageReport(input)).toEqual({id:"void"});expect(m.remove).not.toHaveBeenCalled();expect(m.error).toHaveBeenCalled();});
