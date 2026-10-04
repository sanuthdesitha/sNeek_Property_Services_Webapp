// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/database-runtime",()=>({canUseNodePrisma:()=>true,getDatabaseUrl:()=>"postgresql://isolated@127.0.0.1:1/test",isEdgeLikeRuntime:()=>false}));
let middleware: (params:any,next:(params:any)=>Promise<any>)=>Promise<any>;
const use=vi.fn((handler:typeof middleware)=>{middleware=handler});
let saved: Record<string,unknown>;
const names=["prisma","prismaHasNotificationMiddleware","prismaInitWarned"];
beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();saved={};
 for(const name of names){saved[name]=(globalThis as any)[name];delete (globalThis as any)[name];}
 (globalThis as any).prisma={$use:use};
 await import("@/lib/db");
});
afterEach(()=>{for(const name of names){if(saved[name]===undefined)delete (globalThis as any)[name];else (globalThis as any)[name]=saved[name];}});
it.each(["create","createMany"])("annotates %s transaction input without sending devices",async action=>{
 const row={channel:"PUSH",externalId:"mobile-outbox:pending:cases",status:"SENT",userId:"u"};
 const unclassified={channel:"PUSH",status:"SENT",userId:"u"};
 const params={model:"Notification",action,args:{data:action==="create"?unclassified:[row,unclassified]}};
 const next=vi.fn(async(input)=>({saved:input.args.data}));const network=vi.fn();vi.stubGlobal("fetch",network);
 try{const result=await middleware(params,next);expect(next).toHaveBeenCalledOnce();expect(result).toEqual({saved:params.args.data});expect(network).not.toHaveBeenCalled();expect(JSON.stringify(params.args.data)).toContain("mobile-outbox:REVIEW_REQUIRED");if(action==="createMany")expect(JSON.stringify(params.args.data)).toContain("mobile-outbox:pending:cases");}
 finally{vi.unstubAllGlobals();}
});
it("does not intercept notification updates or unrelated models",async()=>{
 for(const params of [{model:"Notification",action:"update",args:{data:{status:"SENT"}}},{model:"Job",action:"create",args:{data:{status:"DRAFT"}}}]){
  const before=structuredClone(params);const next=vi.fn(async()=>"saved");expect(await middleware(params,next)).toBe("saved");expect(params).toEqual(before);
 }
});
it("propagates failed transaction persistence without delivery or retry",async()=>{
 const next=vi.fn(async()=>{throw new Error("transaction aborted")});
 await expect(middleware({model:"Notification",action:"create",args:{data:{channel:"PUSH",userId:"u"}}},next)).rejects.toThrow("transaction aborted");expect(next).toHaveBeenCalledOnce();
});
it("registers middleware once when the cached client is reused",async()=>{
 vi.resetModules();await import("@/lib/db");expect(use).toHaveBeenCalledOnce();
});

it.each(["create", "createMany", "upsert"])("versions only newly created residential jobs (%s), leaving updates and templates intact", async action => {
 const data = { jobType: "AIRBNB_TURNOVER", internalNotes: "Keep this note", formTemplateId: "property-specific" };
 const args = action === "upsert" ? { create: data, update: { internalNotes: "Existing job" } } : { data: action === "createMany" ? [data] : data };
 const params = { model: "Job", action, args };
 const next = vi.fn(async input => input);
 await middleware(params, next);
 const result = action === "upsert" ? (params.args as any).create : action === "createMany" ? (params.args as any).data[0] : (params.args as any).data;
 expect(JSON.parse(result.internalNotes)).toMatchObject({ internalNoteText: "Keep this note", laundryAreaEvidenceVersion: 1 });
 expect(result.formTemplateId).toBe("property-specific");
 if (action === "upsert") expect((params.args as any).update).toEqual({ internalNotes: "Existing job" });
 expect(data.internalNotes).toBe("Keep this note");
 const update = { model: "Job", action: "update", args: { data } };
 await middleware(update, next);
 expect(update.args.data).toBe(data);
});
