// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), first: vi.fn(), items: vi.fn(), create: vi.fn(), remove: vi.fn(), reportCreate: vi.fn(), reportUpdate: vi.fn(), lock: vi.fn(), transaction: vi.fn(), photoItems: vi.fn(), verify: vi.fn(), linked:vi.fn(), recover:vi.fn(), link:vi.fn(), caseCreate:vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
 damageReport: { findFirst: m.first, findUnique: m.find, findUniqueOrThrow: m.find, create: m.reportCreate, update: m.reportUpdate },
 damageItem: { findMany: m.items, deleteMany: m.remove, create: m.create },
 damageItemPhoto: { findMany: m.photoItems }, $transaction: m.transaction,
} }));
vi.mock("@/lib/cases/service", () => ({ createCase: m.caseCreate }));
vi.mock("@/lib/qa/annotation-composite", () => ({ ensureFlattened: vi.fn() }));
vi.mock("@/lib/reports/verification", () => ({ ensureDamageReportVerification: m.verify }));
import { getDamageDraft, getOrCreateDamageDraft, saveDamageDraft, submitDamageReport } from "@/lib/damage/service";
const item = { clientId: "item", area: "Kitchen", category: "Sink", severity: "MODERATE", description: "Scratch on sink", suspectedCause: "UNKNOWN", photos: [] } as any;
beforeEach(() => {
 vi.resetAllMocks(); m.first.mockResolvedValue(null); m.find.mockResolvedValue({ id: "r", reportedById: "u", status: "DRAFT", items: [] });
 m.items.mockResolvedValue([{ id: "item", caseId: "case", estimatedCost: 123 }]); m.photoItems.mockResolvedValue([]);
 m.transaction.mockImplementation(async fn => fn({ $executeRaw: m.lock,
 damageReport: { findUnique: m.find, findFirst: m.first, create: m.reportCreate, update: m.reportUpdate },
 damageItem: { findMany: m.items, deleteMany: m.remove, create: m.create, findUnique:m.linked,update:m.link },issueTicket:{findFirst:m.recover},
 }));
});
it("reading a missing damage draft never creates a row", async () => {
 expect(await getDamageDraft({ jobId: "j", userId: "u" })).toBeNull(); expect(m.reportCreate).not.toHaveBeenCalled(); expect(m.transaction).not.toHaveBeenCalled();
});
it("reopened draft preserves stable item identity, linked case and admin cost", async () => {
 await saveDamageDraft({ reportId: "r", userId: "u", items: [item] });
 expect(m.create.mock.calls[0][0].data).toMatchObject({ id: "item", caseId: "case", estimatedCost: 123 }); expect(m.lock).toHaveBeenCalled();
});
it("submitted report retry never replaces items or completion timestamp", async () => {
 m.find.mockResolvedValue({ id: "r", reportedById: "u", status: "SUBMITTED", items: [], job: null });
 await submitDamageReport({ reportId: "r", userId: "u", items: [item] });
 expect(m.remove).not.toHaveBeenCalled(); expect(m.reportUpdate).not.toHaveBeenCalled(); expect(m.verify).toHaveBeenCalledWith("r");
});
it("another cleaner cannot mutate a draft", async () => {
 await expect(saveDamageDraft({ reportId: "r", userId: "other", items: [item] })).rejects.toThrow("FORBIDDEN"); expect(m.remove).not.toHaveBeenCalled();
});

it("explicit draft creation returns existing draft without competing row",async()=>{m.first.mockResolvedValue({id:"existing"});expect(await getOrCreateDamageDraft({jobId:"j",propertyId:"p",userId:"u"})).toEqual({id:"existing"});expect(m.reportCreate).not.toHaveBeenCalled();expect(m.lock).toHaveBeenCalled();});
it("explicit first draft is scoped to job and cleaner",async()=>{m.reportCreate.mockResolvedValue({id:"new"});expect(await getOrCreateDamageDraft({jobId:"j",propertyId:"p",userId:"u"})).toEqual({id:"new"});expect(m.reportCreate).toHaveBeenCalledWith(expect.objectContaining({data:{jobId:"j",propertyId:"p",reportedById:"u",status:"DRAFT"}}));});
const submittedReport=()=>({id:"r",jobId:"j",propertyId:"p",reportedById:"u",status:"SUBMITTED",job:{property:{clientId:"client"}},items:[{id:"item",caseId:null,area:"Kitchen",category:"Sink",description:"Scratch",severity:"MODERATE",photos:[{s3Key:"photo",flatKey:"flat"}]}]});
it("draft submission saves once and commits a submitted snapshot",async()=>{m.reportUpdate.mockResolvedValue({id:"r",items:[]});await submitDamageReport({reportId:"r",userId:"u",items:[item]});expect(m.reportUpdate).toHaveBeenCalledWith(expect.objectContaining({data:{status:"SUBMITTED",submittedAt:expect.any(Date)}}));expect(m.remove).toHaveBeenCalledTimes(1);});
it("retry recovers orphan case link rather than creating duplicate repair",async()=>{m.find.mockResolvedValue(submittedReport());m.linked.mockResolvedValue({caseId:null});m.recover.mockResolvedValue({id:"existing-case"});await submitDamageReport({reportId:"r",userId:"u",items:[]});expect(m.link).toHaveBeenCalledWith({where:{id:"item"},data:{caseId:"existing-case"}});expect(m.caseCreate).not.toHaveBeenCalled();});
it("already linked damage is skipped on retry",async()=>{m.find.mockResolvedValue(submittedReport());m.linked.mockResolvedValue({caseId:"case"});await submitDamageReport({reportId:"r",userId:"u",items:[]});expect(m.caseCreate).not.toHaveBeenCalled();expect(m.recover).not.toHaveBeenCalled();});
it("unlinked damage creates private case and drains callback only after transaction",async()=>{m.find.mockResolvedValue(submittedReport());m.linked.mockResolvedValue({caseId:null});let linked=false;const effect=vi.fn(async()=>{expect(linked).toBe(true)});m.link.mockImplementation(async()=>{linked=true});m.caseCreate.mockImplementation(async(_input,options)=>{options.afterCommit.push(effect);return{id:"new-case"}});await submitDamageReport({reportId:"r",userId:"u",items:[]});expect(m.caseCreate).toHaveBeenCalledWith(expect.objectContaining({clientVisible:false,clientCanReply:false,metadata:expect.objectContaining({damageItemId:"item"}),attachments:[{uploadedByUserId:"u",s3Key:"flat"}]}),expect.objectContaining({transaction:expect.any(Object)}));expect(effect).toHaveBeenCalledTimes(1);});
it("linked case failure propagates and cannot claim completed repair",async()=>{m.find.mockResolvedValue(submittedReport());m.linked.mockResolvedValue({caseId:null});m.caseCreate.mockRejectedValue(new Error("repair insert failed"));await expect(submitDamageReport({reportId:"r",userId:"u",items:[]})).rejects.toThrow("repair insert failed");expect(m.link).not.toHaveBeenCalled();});
