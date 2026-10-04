// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ user: { id: "admin" } }) }));
vi.mock("@/lib/db", () => ({ db: { cleanerInvoiceSubmission: { findUnique: m.find, update: m.update }, user: { findUnique: async () => ({ name: "Payee", role: "CLEANER" }) }, $transaction: async (fn: any) => fn({ $executeRaw: vi.fn(), $queryRaw: vi.fn(), cleanerInvoiceSubmission: { findUnique: m.find, update: m.update } }) } }));
vi.mock("@/lib/xero/client", () => ({ pushCleanerBillToXero: m.push }));
import { POST } from "@/app/api/admin/cleaner-invoices/[id]/xero-push/route";
let submission: any;
const request = () => POST(new Request("http://localhost/export", { method: "POST" }) as any, { params: { id: "submission" } });
beforeEach(() => { vi.resetAllMocks(); submission = { id: "submission", status: "SUBMITTED", cleanerId: "cleaner", periodStart: new Date(), periodEnd: new Date(), lineData: { lines: [{ description: "Work", quantity: 1, unitAmount: 50 }] } }; m.find.mockImplementation(async () => submission); m.push.mockResolvedValue({ xeroBillId: "remote" }); });
it.each(["VOID", "CHANGES_REQUESTED", "PAID", "SENDING", "PAID_CLAIMED"])("rejects %s without touching provider", async status => { submission.status = status; expect((await request()).status).toBe(409); expect(m.push).not.toHaveBeenCalled(); });
it("rejects settlement evidence even if status was edited", async () => { submission.paidAmount = 50; expect((await request()).status).toBe(409); expect(m.push).not.toHaveBeenCalled(); });
it("rejects previously exported document", async () => { submission.xeroBillId = "existing"; expect((await request()).status).toBe(409); expect(m.push).not.toHaveBeenCalled(); });
it("keeps provider key stable when export succeeded but persistence failed", async () => {
 let failed = false; m.update.mockImplementation(async ({ data }) => { if (data.status === "XERO_PUSHED" && !failed) { failed = true; throw new Error("persistence interrupted"); } return {}; }); expect((await request()).status).toBe(400); expect((await request()).status).toBe(200);
 expect(m.push.mock.calls.map(([payload]) => payload.idempotencyKey)).toEqual(["cleaner-invoice-submission", "cleaner-invoice-submission"]);
});
it.each([{status:'PAID'},{paidAmount:0},{xeroBillId:'remote'},null])('rechecks export eligibility under the reservation lock %j',async change=>{m.find.mockResolvedValueOnce({...submission}).mockResolvedValueOnce(change?{...submission,...change}:null);expect((await request()).status).toBe(400);expect(m.push).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();});
it('retries a reserved export using the same document identity',async()=>{submission.status='XERO_EXPORTING';expect((await request()).status).toBe(200);expect(m.push.mock.calls[0][0].idempotencyKey).toBe('cleaner-invoice-submission');});
