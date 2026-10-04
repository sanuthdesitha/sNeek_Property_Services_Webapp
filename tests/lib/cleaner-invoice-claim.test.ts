// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ tx: vi.fn(), previous: vi.fn(), create: vi.fn(), jobCount: vi.fn(), adjustment: vi.fn(), qa: vi.fn(), travel: vi.fn(), owned: vi.fn(), shopping: vi.fn(), locks: vi.fn(), shoppingCount: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.tx } }));
vi.mock("@/lib/billing/invoice-sequence", () => ({ issueInvoiceNumber: async () => "CL-1" }));
vi.mock("@/lib/inventory/shopping-runs", () => ({ markCleanerShoppingRunsInvoiced: m.owned, stampShoppingSettlementsForCleanerInvoice: m.shopping }));
import { claimCleanerInvoice } from "@/lib/cleaner/invoice-claim";
let data: any; let events: string[];
beforeEach(() => {
 vi.resetAllMocks(); events = [];
 data = { start: new Date(), end: new Date(), rows: [{ jobId: "job" }], extraLineRows: [], qaInspectionRows: [], expenseRows: [], shoppingTimeRows: [], includedAdjustmentIds: [], claimableAllowanceDays: [], transportAllowanceRows: [], hours: 1, estimatedPay: 50 };
 m.previous.mockResolvedValue([]); m.jobCount.mockResolvedValue(1); m.adjustment.mockResolvedValue({ count: 1 }); m.qa.mockResolvedValue({ count: 1 }); m.travel.mockResolvedValue({ count: 1 }); m.owned.mockResolvedValue(["run"]);
 m.create.mockImplementation(async () => { events.push("receipt"); return { id: "receipt", invoiceNumber: "CL-1", status: "SENDING" }; });
 m.tx.mockImplementation(async fn => { try { const result = await fn({ $executeRaw: m.locks, $queryRaw: m.locks, cleanerInvoiceSubmission: { findMany: m.previous, create: m.create }, shoppingRun: { count: m.shoppingCount }, job: { count: m.jobCount }, cleanerPayAdjustment: { updateMany: m.adjustment }, qaAssignment: { updateMany: m.qa }, qaDayAllowance: { createMany: vi.fn(), updateMany: m.travel } }); events.push("commit"); return result; } catch (error) { events.push("rollback"); throw error; } });
});
const claim = () => claimCleanerInvoice({ cleanerId: "cleaner", requestId: "request", data, lineData: { jobIds: ["job"] } });
it("commits durable receipt and all streams before returning delivery permission", async () => {
 data.includedAdjustmentIds = ["extra"]; data.qaInspectionRows = [{ assignmentId: "qa", amount: 20 }]; data.expenseRows = [{ runId: "run", amount: 10 }]; data.claimableAllowanceDays = ["2026-10-03"]; data.transportAllowanceRows = [{ day: "2026-10-03", amount: 5 }];
 expect(await claim()).toMatchObject({ id: "receipt", reused: false }); expect(events).toEqual(["receipt", "commit"]);
 expect(m.adjustment.mock.calls[0][0].where).toMatchObject({ includedInPayrollRunId: null, includedInCleanerInvoiceId: null, status: "APPROVED" });
 expect(m.shopping).toHaveBeenCalledWith(expect.objectContaining({ requireAll: true, invoiceId: "receipt" }), expect.anything());
 expect(m.qa).toHaveBeenCalledOnce(); expect(m.travel).toHaveBeenCalledOnce();
});
it("returns an existing request receipt without claiming or delivering twice", async () => {
 m.previous.mockResolvedValue([{ id: "old", status: "SUBMITTED", lineData: { requestId: "request", jobIds: ["job"] } }]);
 expect(await claim()).toMatchObject({ id: "old", reused: true }); expect(m.create).not.toHaveBeenCalled();
});
it("blocks another request while an ambiguous SENDING receipt exists", async () => {
 m.previous.mockResolvedValue([{ id: "ambiguous", status: "SENDING", lineData: {} }]);
 expect(await claim()).toMatchObject({ id: "ambiguous", reused: true }); expect(m.create).not.toHaveBeenCalled();
});
it("refuses jobs on a different live invoice", async () => {
 m.previous.mockResolvedValue([{ id: "old", status: "SUBMITTED", lineData: { jobIds: ["job"] } }]);
 await expect(claim()).rejects.toThrow("Invoice work changed"); expect(m.create).not.toHaveBeenCalled();
});
it("refuses payroll-claimed or reassigned jobs before creating receipt", async () => {
 m.jobCount.mockResolvedValue(0); await expect(claim()).rejects.toThrow("claimed by payroll"); expect(m.create).not.toHaveBeenCalled();
});
it.each(["adjustment", "qa", "travel", "shopping"])("rolls back every claim when %s loses a race", async kind => {
 data.includedAdjustmentIds = ["extra"]; data.qaInspectionRows = [{ assignmentId: "qa", amount: 20 }]; data.expenseRows = [{ runId: "run", amount: 10 }]; data.claimableAllowanceDays = ["2026-10-03"]; data.transportAllowanceRows = [{ day: "2026-10-03", amount: 5 }];
 if (kind === "shopping") m.shopping.mockRejectedValue(new Error("already claimed")); else m[kind as "adjustment" | "qa" | "travel"].mockResolvedValue({ count: 0 });
 await expect(claim()).rejects.toThrow("already claimed"); expect(events.at(-1)).toBe("rollback"); expect(events).not.toContain("commit");
});

it("refuses empty work before allocating a receipt",async()=>{data.rows=[];await expect(claim()).rejects.toThrow("No uninvoiced work");expect(m.create).not.toHaveBeenCalled();});
it("accepts only the reviewed versions for every money stream",async()=>{
 const version="2026-10-03T00:00:00.000Z";
 data.claimVersions={jobs:{job:version},adjustments:{extra:version},qa:{qa:version},shopping:{run:version}};
 data.includedAdjustmentIds=["extra"];data.qaInspectionRows=[{assignmentId:"qa",amount:20}];data.shoppingTimeRows=[{runId:"run",amount:25}];
 m.shoppingCount.mockResolvedValue(1);
 await claim();
 expect(m.jobCount.mock.calls[0][0].where.OR).toEqual([{id:"job",updatedAt:new Date(version)}]);
 expect(m.adjustment.mock.calls[0][0].where.updatedAt).toEqual(new Date(version));
 expect(m.qa.mock.calls[0][0].where.updatedAt).toEqual(new Date(version));
 expect(m.shopping).toHaveBeenCalledWith(expect.objectContaining({time:[{runId:"run",amount:25}]}),expect.anything());
});
it("rolls back a changed shopping snapshot before claiming money",async()=>{data.claimVersions={jobs:{},adjustments:{},qa:{},shopping:{run:"2026-10-03T00:00:00.000Z"}};data.rows=[];data.expenseRows=[{runId:"run",amount:20}];m.shoppingCount.mockResolvedValue(0);await expect(claim()).rejects.toThrow("Shopping amounts changed");expect(m.shopping).not.toHaveBeenCalled();expect(events.at(-1)).toBe("rollback");});
it("allows a new expense-only request with legacy unrelated invoice metadata",async()=>{data.rows=[];data.extraLineRows=[{amount:1}];data.claimableAllowanceDays=undefined;m.previous.mockResolvedValue([{status:"SUBMITTED",lineData:null}]);await expect(claimCleanerInvoice({cleanerId:"cleaner",data,lineData:{}})).resolves.toMatchObject({reused:false});expect(m.create.mock.calls[0][0].data.lineData.requestId).toBeNull();});
it.each(['jobs','adjustments','qa','shopping'] as const)('does not substitute an unconstrained query when %s snapshot version is missing',async stream=>{
 data.rows=[];data.extraLineRows=[{amount:1}];data.claimVersions={jobs:{},adjustments:{},qa:{},shopping:{}};
 const rejectInvalidVersion=async(args:any)=>{
  const date=args.where.updatedAt ?? args.where.OR?.[0]?.updatedAt;
  expect(date).toBeInstanceOf(Date);expect(Number.isNaN(date.getTime())).toBe(true);
  throw new Error('Invalid Date rejected by database client');
 };
 if(stream==='jobs'){data.rows=[{jobId:'job'}];m.jobCount.mockImplementation(rejectInvalidVersion);}
 if(stream==='adjustments'){data.includedAdjustmentIds=['extra'];m.adjustment.mockImplementation(rejectInvalidVersion);}
 if(stream==='qa'){data.qaInspectionRows=[{assignmentId:'qa',amount:20}];m.qa.mockImplementation(rejectInvalidVersion);}
 if(stream==='shopping'){data.expenseRows=[{runId:'run',amount:20}];m.shoppingCount.mockImplementation(rejectInvalidVersion);}
 await expect(claim()).rejects.toThrow('Invalid Date rejected');expect(events.at(-1)).toBe('rollback');expect(events).not.toContain('commit');
});

vi.mock("@/lib/finance/holiday-rates", () => ({ assertHolidayRateSnapshots: vi.fn(async () => {}) }));

import { assertHolidayRateSnapshots } from "@/lib/finance/holiday-rates";
it("stops invoice claims when a holiday snapshot has drifted", async () => {
 vi.mocked(assertHolidayRateSnapshots).mockRejectedValueOnce(new Error("Holiday snapshot changed"));
 await expect(claim()).rejects.toThrow("Holiday snapshot changed");
 expect(m.create).not.toHaveBeenCalled(); expect(events.at(-1)).toBe("rollback");
});
