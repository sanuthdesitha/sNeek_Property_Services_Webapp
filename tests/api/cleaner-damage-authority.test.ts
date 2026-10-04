// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({role:vi.fn(),job:vi.fn(),report:vi.fn(),read:vi.fn(),create:vi.fn(),save:vi.fn(),submit:vi.fn()}));
vi.mock("@/lib/auth/session",()=>({requireRole:m.role}));
vi.mock("@/lib/db",()=>({db:{job:{findFirst:m.job},damageReport:{findFirst:m.report}}}));
vi.mock("@/lib/damage/service",()=>({getDamageDraft:m.read,getOrCreateDamageDraft:m.create,saveDamageDraft:m.save,submitDamageReport:m.submit}));
vi.mock("@/lib/s3",()=>({publicUrl:(key:string)=>`https://evidence.invalid/${key}`}));
import { GET, PUT, POST } from "@/app/api/cleaner/jobs/[id]/damage/route";
const ctx={params:{id:"job"}};
const item={area:"Kitchen",category:"Sink",description:"Visible crack in sink",photos:[{s3Key:"photo"}],estimatedCost:999};
const request=(method:string,body:unknown)=>new Request("http://localhost/api/damage",{method,body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();m.role.mockResolvedValue({user:{id:"cleaner"}});m.job.mockResolvedValue({id:"job",propertyId:"property"});m.report.mockResolvedValue({id:"draft"});m.read.mockResolvedValue(null);m.create.mockResolvedValue({id:"created"});m.save.mockResolvedValue({id:"draft",items:[]});m.submit.mockResolvedValue({id:"draft",items:[]});});
it("reads an absent draft without provisioning and scopes lookup to the assigned cleaner",async()=>{
 expect((await GET(new Request("http://localhost"),ctx)).status).toBe(200);
 expect(m.read).toHaveBeenCalledWith({jobId:"job",userId:"cleaner"});expect(m.create).not.toHaveBeenCalled();
 expect(m.job).toHaveBeenCalledWith(expect.objectContaining({where:{id:"job",assignments:{some:{userId:"cleaner",removedAt:null}}}}));
});
it.each([PUT,POST])("rejects foreign report identity without saving or submitting",async handler=>{
 m.report.mockResolvedValue(null);const res=await handler(request(handler===PUT?"PUT":"POST",{reportId:"foreign",items:[item]}),ctx);
 expect(res.status).toBe(404);expect(m.report).toHaveBeenCalledWith({where:{id:"foreign",jobId:"job",reportedById:"cleaner"},select:{id:true}});
 expect(m.save).not.toHaveBeenCalled();expect(m.submit).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();
});
it.each([GET,PUT,POST])("blocks unassigned cleaners before accessing report data",async handler=>{
 m.job.mockResolvedValue(null);const res=await handler(request("POST",{reportId:"draft",items:[item]}),ctx);
 expect(res.status).toBe(404);expect(m.report).not.toHaveBeenCalled();expect(m.read).not.toHaveBeenCalled();expect(m.save).not.toHaveBeenCalled();expect(m.submit).not.toHaveBeenCalled();
});
it.each(["UNAUTHORIZED","FORBIDDEN"])("preserves %s response without querying jobs",async error=>{
 m.role.mockRejectedValue(new Error(error));expect((await GET(new Request("http://localhost"),ctx)).status).toBe(error==="UNAUTHORIZED"?401:403);expect(m.job).not.toHaveBeenCalled();
});
it("autosaves an owned identity without creating another draft and strips client cost",async()=>{
 await PUT(request("PUT",{reportId:"draft",items:[item]}),ctx);expect(m.create).not.toHaveBeenCalled();expect(m.save.mock.calls[0][0]).toMatchObject({reportId:"draft",userId:"cleaner"});expect(m.save.mock.calls[0][0].items[0]).not.toHaveProperty("estimatedCost");
});
it("only explicit first save provisions a draft",async()=>{
 await PUT(request("PUT",{items:[]}),ctx);expect(m.create).toHaveBeenCalledWith({jobId:"job",propertyId:"property",userId:"cleaner"});expect(m.save).toHaveBeenCalledWith({reportId:"created",userId:"cleaner",items:[]});
});
it("submits a verified owned report and returns composite evidence URLs",async()=>{
 m.submit.mockResolvedValue({id:"draft",items:[{photos:[{flatKey:"composite",s3Key:"original"},{s3Key:"raw"}]}]});
 const res=await POST(request("POST",{reportId:"draft",items:[item]}),ctx);expect(res.status).toBe(200);
 expect(m.submit.mock.calls[0][0]).toMatchObject({reportId:"draft",userId:"cleaner"});expect(m.submit.mock.calls[0][0].items[0]).not.toHaveProperty("estimatedCost");
 expect((await res.json()).report.items[0].photos.map((p:any)=>p.url)).toEqual(["https://evidence.invalid/composite","https://evidence.invalid/raw"]);
});
it("returns conflict when submitted evidence cannot be edited",async()=>{
 m.save.mockRejectedValue(new Error("DAMAGE_REPORT_NOT_EDITABLE"));expect((await PUT(request("PUT",{reportId:"draft",items:[]}),ctx)).status).toBe(409);
});
