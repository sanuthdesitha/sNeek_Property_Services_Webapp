// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ job: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn(), settings: vi.fn(), checklist: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.job }, qaFormTemplate: { findFirst: m.find, create: m.create, update: m.update }, formTemplate: { findFirst: m.checklist } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/qa/generate-from-checklist",()=>({generateQaTemplateFromChecklist:m.generate}));
import { resolveQaTemplate } from "@/lib/qa/template-resolution";
beforeEach(() => { vi.resetAllMocks(); m.job.mockResolvedValue({ jobType: "AIRBNB_TURNOVER", propertyId: "p" }); m.find.mockResolvedValue(null); m.settings.mockResolvedValue({}); });
it("missing QA template is a usable preview without GET provisioning", async () => {
 const result = await resolveQaTemplate("j"); expect(result?.id).toBe("preview:j"); expect(result?.schema).toBeTruthy(); expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
});
it("opening a stale default does not rewrite its schema", async () => {
 const old = { id: "t", isSystemManaged: true, schema: { version: 0 } }; m.find.mockResolvedValueOnce(null).mockResolvedValueOnce(old);
 expect(await resolveQaTemplate("j")).toEqual(old); expect(m.update).not.toHaveBeenCalled();
});
it("explicit submission may provision the preview", async () => {
 m.create.mockResolvedValue({ id: "persisted" }); expect(await resolveQaTemplate("j", true)).toEqual({ id: "persisted" }); expect(m.create).toHaveBeenCalledTimes(1);
});

it("missing job yields no template or provisioning",async()=>{m.job.mockResolvedValue(null);expect(await resolveQaTemplate("missing",true)).toBeNull();expect(m.find).not.toHaveBeenCalled();});
it("an active property-owned template always wins",async()=>{const custom={id:"custom",schema:{version:0},isSystemManaged:false};m.find.mockResolvedValue(custom);expect(await resolveQaTemplate("j",true)).toBe(custom);expect(m.settings).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();});
it.each([false,true])("property checklist derives a usable template (persist=%s)",async(persist)=>{
 m.settings.mockResolvedValue({propertyFormTemplateOverrides:{p:{AIRBNB_TURNOVER:"checklist"}}});m.checklist.mockResolvedValue({id:"checklist",schema:{sections:[]}});m.generate.mockReturnValue({schema:{version:2,sections:[{id:"bed"}]}});m.create.mockResolvedValue({id:"generated"});
 const result=await resolveQaTemplate("j",persist);expect(result?.id).toBe(persist?"generated":"preview:j");
 if(persist)expect(m.create).toHaveBeenCalledWith({data:expect.objectContaining({propertyId:"p",sourceFormTemplateId:"checklist",isSystemManaged:false})});else expect(m.create).not.toHaveBeenCalled();
});
it("failed checklist lookup falls back to existing global template",async()=>{m.settings.mockRejectedValue(new Error("settings unavailable"));m.find.mockResolvedValueOnce(null).mockResolvedValueOnce({id:"global",schema:null});expect(await resolveQaTemplate("j")).toMatchObject({id:"global"});expect(m.create).not.toHaveBeenCalled();});
it.each([null,"invalid",{}, {version:0}])("explicit save upgrades stale system template %j",async(schema)=>{m.find.mockResolvedValueOnce(null).mockResolvedValueOnce({id:"global",isSystemManaged:true,schema});m.update.mockResolvedValue({id:"upgraded"});expect(await resolveQaTemplate("j",true)).toMatchObject({id:"upgraded"});expect(m.update).toHaveBeenCalledTimes(1);});
it.each([{isSystemManaged:false,schema:{version:0}},{isSystemManaged:true,schema:{version:999}}])("does not overwrite owned or current global schema",async(template)=>{m.job.mockResolvedValue({jobType:"AIRBNB_TURNOVER",propertyId:null});m.find.mockResolvedValueOnce(null).mockResolvedValueOnce({id:"global",...template});expect(await resolveQaTemplate("j",true)).toMatchObject({id:"global"});expect(m.settings).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();});
