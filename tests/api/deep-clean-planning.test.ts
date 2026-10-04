// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), verify: vi.fn(), schedule: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/properties/deep-clean-planning", () => ({ readDeepCleanPlan:m.read,verifyDeepCleanBaseline:m.verify,scheduleDeepCleanProposal:m.schedule,listDeepCleanProposals:m.list,DeepCleanPlanningError: class extends Error { constructor(public status:number,public code:string,message:string){super(message);} } }));
import { DeepCleanPlanningError } from "@/lib/properties/deep-clean-planning";
import { GET, POST } from "@/app/api/admin/properties/[id]/deep-clean-planning/route";
import { GET as queue } from "@/app/api/admin/deep-clean-proposals/route";
const ctx = { params:{id:"p"} };
const req = (body?:unknown) => new NextRequest("http://localhost/api/admin/properties/p/deep-clean-planning",body===undefined?undefined:{method:"POST",body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();m.auth.mockResolvedValue({user:{id:"owner",role:"OPS_MANAGER",heldRoles:["OPS_MANAGER","ADMIN"]}});m.read.mockResolvedValue({plan:{revision:0}});m.verify.mockResolvedValue({revision:1});m.schedule.mockResolvedValue({jobId:"draft"});m.list.mockResolvedValue({proposals:[],nextCursor:null});});
it("read admits office and exposes held administrator mutation capability",async()=>{expect(await (await GET(req(),ctx)).json()).toMatchObject({canManage:true});expect(m.auth).toHaveBeenCalledWith(["ADMIN","OPS_MANAGER"]);m.auth.mockResolvedValue({user:{role:"OPS_MANAGER"}});expect(await (await GET(req(),ctx)).json()).toMatchObject({canManage:false});});
it.each(["UNAUTHORIZED","FORBIDDEN"])("rejects %s before read or write",async message=>{m.auth.mockRejectedValue(new Error(message));expect((await GET(req(),ctx)).status).toBe(message==="UNAUTHORIZED"?401:403);expect((await POST(req({action:"verify"}),ctx)).status).toBe(message==="UNAUTHORIZED"?401:403);expect(m.read).not.toHaveBeenCalled();expect(m.verify).not.toHaveBeenCalled();});
it("verification requires explicit attestation and uses route property and actor",async()=>{const body={action:"verify",jobId:"done",revision:2,reviewNote:" reviewed ",evidenceReviewed:true,propertyId:"spoof"};expect((await POST(req(body),ctx)).status).toBe(200);expect(m.auth).toHaveBeenCalledWith(["ADMIN"]);expect(m.verify).toHaveBeenCalledWith(expect.objectContaining({propertyId:"p",reviewNote:"reviewed",evidenceReviewed:true}),"owner");expect((await POST(req({...body,evidenceReviewed:false}),ctx)).status).toBe(400);expect(m.verify).toHaveBeenCalledOnce();});
it("scheduling passes explicit date and stale conflict to caller",async()=>{const body={action:"schedule",proposalId:"proposal",revision:3,date:"2026-10-06"};expect(await (await POST(req(body),ctx)).json()).toEqual({jobId:"draft"});expect(m.schedule).toHaveBeenCalledWith({...body,propertyId:"p"},"owner");m.schedule.mockRejectedValue(new DeepCleanPlanningError(409,"REVISION_CONFLICT","Reload changed plan"));expect((await POST(req(body),ctx)).status).toBe(409);expect((await POST(req({...body,date:""}),ctx)).status).toBe(400);});
it("queue passes cursor and does not mutate",async()=>{expect((await queue(new NextRequest("http://localhost/api?cursor=next"))).status).toBe(200);expect(m.list).toHaveBeenCalledWith("next");expect(m.verify).not.toHaveBeenCalled();expect(m.schedule).not.toHaveBeenCalled();});
it.each([[new Error("UNAUTHORIZED"),401],[new Error("FORBIDDEN"),403],[new DeepCleanPlanningError(409,"INVALID","Malformed plan"),409],[new Error("Storage unavailable"),500]])("queue returns failures without an empty success",async(error,status)=>{m.list.mockRejectedValue(error);expect((await queue(new NextRequest("http://localhost/api"))).status).toBe(status);});

it("queue without cursor handles a non-Error storage rejection explicitly", async () => {
  m.list.mockRejectedValue("storage offline");
  const result = await queue(new NextRequest("http://localhost/api"));
  expect(m.list).toHaveBeenCalledWith(undefined);
  expect(result.status).toBe(500);
  expect(await result.json()).toEqual({ error: "Could not load deep-clean proposals." });
});
