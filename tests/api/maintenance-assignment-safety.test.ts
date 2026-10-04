// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), find: vi.fn(), update: vi.fn(), notify: vi.fn(), users: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: m.session }));
vi.mock("@/lib/db", () => ({ db: { maintenanceItemAssignment: { findUnique: m.find, updateMany: m.update, update: m.update }, notification: { createMany: m.notify }, user: { findMany: m.users } } }));
import { PATCH } from "@/app/api/maintenance/assignments/[id]/route";
const run = (action: string) => PATCH(new Request("http://localhost/api/maintenance/assignments/a", { method: "PATCH", body: JSON.stringify({ action }) }) as any, { params: { id: "a" } });
beforeEach(() => { vi.resetAllMocks(); m.session.mockResolvedValue({ user: { id: "u", name: "Worker" } }); m.find.mockResolvedValue({ id: "a", userId: "u", acceptedAt: new Date(), completedAt: null, item: { title: "Fix", property: { name: "Property" } } }); m.update.mockResolvedValue({ count: 0 }); });
it("repeat completion preserves timestamp and does not notify again", async () => {
 const res = await run("COMPLETE"); expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ unchanged: true }); expect(m.notify).not.toHaveBeenCalled();
 expect(m.update.mock.calls[0][0].where).toMatchObject({ completedAt: null, acceptedAt: { not: null }, removedAt: null });
});
it("completed work cannot be declined", async () => {
 m.find.mockResolvedValue({ id: "a", userId: "u", completedAt: new Date(), item: { title: "Fix", property: {} } });
 expect((await run("DECLINE")).status).toBe(409); expect(m.update).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled();
});
it("other assignee cannot act on record", async () => {
 m.session.mockResolvedValue({ user: { id: "other" } }); expect((await run("COMPLETE")).status).toBe(404); expect(m.update).not.toHaveBeenCalled();
});

it("repeated pending pay request creates no office notification",async()=>{
 const res=await PATCH(new Request("http://localhost",{method:"PATCH",body:JSON.stringify({action:"REQUEST_PAY_CHANGE",amount:50})}) as any,{params:{id:"a"}});expect(res.status).toBe(200);expect(await res.json()).toMatchObject({unchanged:true});expect(m.notify).not.toHaveBeenCalled();expect(m.update).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({removedAt:null,OR:expect.any(Array)})}));
});
it("accepted assignment retry preserves existing acceptance timestamp",async()=>{const response=await run("ACCEPT");expect(response.status).toBe(200);expect(m.update).not.toHaveBeenCalled();});
it("first acceptance conditionally stamps acceptance without an office alert",async()=>{m.find.mockResolvedValue({id:"a",userId:"u",acceptedAt:null,completedAt:null,item:{title:"Fix",property:{name:"Home"}}});m.update.mockResolvedValue({count:1});m.users.mockResolvedValue([{id:"admin"}]);const response=await run("ACCEPT");expect(response.status).toBe(200);expect(m.update).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({acceptedAt:null,removedAt:null}),data:expect.objectContaining({acceptedAt:expect.any(Date),declinedAt:null})}));expect(m.notify).not.toHaveBeenCalled();});

it("successful decline conditionally clears acceptance and alerts office",async()=>{m.update.mockResolvedValue({count:1});m.users.mockResolvedValue([{id:"admin"}]);const response=await run("DECLINE");expect(response.status).toBe(200);expect(m.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({acceptedAt:null,declinedAt:expect.any(Date)})}));expect(m.notify).toHaveBeenCalledTimes(1);});
it("acceptance losing a race to removal or completion returns conflict, not fabricated success",async()=>{m.find.mockResolvedValue({id:"a",userId:"u",acceptedAt:null,completedAt:null,item:{title:"Fix",property:{name:"Home"}}});m.update.mockResolvedValue({count:0});const response=await run("ACCEPT");expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:expect.stringMatching(/reload/i)});expect(m.notify).not.toHaveBeenCalled();});
