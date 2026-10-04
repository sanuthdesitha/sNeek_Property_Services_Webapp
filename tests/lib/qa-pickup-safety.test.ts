// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rows: vi.fn(), create: vi.fn(), update: vi.fn(), lock: vi.fn(), cleaners: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transaction } }));
import { pickUpQaAssignment } from "@/lib/qa/pickup";
beforeEach(() => { vi.resetAllMocks(); m.rows.mockResolvedValue([]); m.cleaners.mockResolvedValue([]); m.transaction.mockImplementation(async fn => fn({ $executeRaw: m.lock, jobAssignment: { findMany: m.cleaners }, qaAssignment: { findMany: m.rows, update: m.update, create: m.create } })); });
it("cannot take someone else's self-picked open-pool inspection", async () => {
 m.rows.mockResolvedValue([{ assignedToId: null, pickedUpById: "other", status: "IN_PROGRESS" }]);
 await expect(pickUpQaAssignment({ jobId: "j", userId: "u" })).rejects.toThrow("FORBIDDEN"); expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(m.lock).toHaveBeenCalled();
});
it("cannot create competing assignment when another inspector is assigned", async () => {
 m.rows.mockResolvedValue([{ assignedToId: "other", pickedUpById: null, status: "ASSIGNED" }]);
 await expect(pickUpQaAssignment({ jobId: "j", userId: "u" })).rejects.toThrow("FORBIDDEN"); expect(m.create).not.toHaveBeenCalled();
});
it("repeat pickup returns unchanged so callers skip cleaner nudges", async () => {
 const row = { id: "a", assignedToId: "u", pickedUpById: "u", status: "IN_PROGRESS" }; m.rows.mockResolvedValue([row]);
 expect(await pickUpQaAssignment({ jobId: "j", userId: "u" })).toEqual({ assignment: row, unchanged: true }); expect(m.update).not.toHaveBeenCalled();
});
it("claims the open pool and records the first pickup time",async()=>{
 m.rows.mockResolvedValue([{id:"open",assignedToId:null,pickedUpById:null,pickedUpAt:null,status:"OPEN"}]);m.update.mockResolvedValue({id:"open",status:"IN_PROGRESS"});
 expect(await pickUpQaAssignment({jobId:"j",userId:"u"})).toMatchObject({unchanged:false,assignment:{id:"open"}});
 expect(m.update).toHaveBeenCalledWith({where:{id:"open"},data:{status:"IN_PROGRESS",pickedUpById:"u",pickedUpAt:expect.any(Date)}});expect(m.create).not.toHaveBeenCalled();
});
it("assigned inspector retains prior pickup timestamp and supplies an early-start reason",async()=>{
 const pickedUpAt=new Date("2026-01-01");m.rows.mockResolvedValue([{id:"a",assignedToId:"u",pickedUpById:null,pickedUpAt,status:"ASSIGNED"}]);
 await pickUpQaAssignment({jobId:"j",userId:"u",earlyStartReason:"Client released room early"});
 expect(m.update).toHaveBeenCalledWith(expect.objectContaining({data:{status:"IN_PROGRESS",pickedUpById:"u",pickedUpAt,earlyStartReason:"Client released room early"}}));
});
it("creates one active assignment when none exists",async()=>{
 m.create.mockResolvedValue({id:"new"});expect(await pickUpQaAssignment({jobId:"j",userId:"u",earlyStartReason:null})).toEqual({assignment:{id:"new"},unchanged:false});expect(m.create).toHaveBeenCalledWith({data:{jobId:"j",status:"IN_PROGRESS",pickedUpById:"u",pickedUpAt:expect.any(Date),earlyStartReason:null}});
});
it("self-inspection refusal happens before any pickup write",async()=>{
 m.cleaners.mockResolvedValue([{userId:"u"}]);await expect(pickUpQaAssignment({jobId:"j",userId:"u"})).rejects.toThrow(/cannot inspect/);expect(m.rows).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();
});
