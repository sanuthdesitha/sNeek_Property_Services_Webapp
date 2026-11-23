// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ user: { id: "admin" } }) }));
vi.mock("@/lib/db", () => ({ db: { cleanerInvoiceSubmission: { findUnique: m.find, update: m.update }, user: { findUnique: async () => ({ name: "Payee", role: "CLEANER" }) }, $transaction: async (fn: any) => fn({ $executeRaw: vi.fn(), $queryRaw: vi.fn(), cleanerInvoiceSubmission: { findUnique: m.find, update: m.update } }) } }));
vi.mock("@/lib/xero/client", () => ({ pushCleanerBillToXero: m.push }));
const settings = vi.hoisted(() => ({ xero: { cleanerBillAccountCode: "477", cleanerBillInspectionAccountCode: "", cleanerBillReimbursementAccountCode: "" } as Record<string, string> }));
vi.mock("@/lib/phase3/integrations", () => ({ getPhase3IntegrationsSettings: async () => settings }));
import { POST } from "@/app/api/admin/cleaner-invoices/[id]/xero-push/route";
let submission: any;
const request = () => POST(new Request("http://localhost/export", { method: "POST" }) as any, { params: { id: "submission" } });
beforeEach(() => { vi.resetAllMocks(); submission = { id: "submission", status: "APPROVED", cleanerId: "cleaner", periodStart: new Date(), periodEnd: new Date(), lineData: { lines: [{ description: "Work", quantity: 1, unitAmount: 50 }] } }; m.find.mockImplementation(async () => submission); m.push.mockResolvedValue({ xeroBillId: "remote" }); });
// 2026-11-11: push requires APPROVED; a legacy SUBMITTED invoice is approved first.
it.each(["SUBMITTED", "VOID", "CHANGES_REQUESTED", "PAID", "SENDING", "PAID_CLAIMED"])("rejects %s without touching provider", async status => { submission.status = status; expect((await request()).status).toBe(409); expect(m.push).not.toHaveBeenCalled(); });
it("rejects settlement evidence even if status was edited", async () => { submission.paidAmount = 50; expect((await request()).status).toBe(409); expect(m.push).not.toHaveBeenCalled(); });
it("rejects previously exported document", async () => { submission.xeroBillId = "existing"; expect((await request()).status).toBe(409); expect(m.push).not.toHaveBeenCalled(); });
it("keeps provider key stable when export succeeded but persistence failed", async () => {
 let failed = false; m.update.mockImplementation(async ({ data }) => { if (data.status === "XERO_PUSHED" && !failed) { failed = true; throw new Error("persistence interrupted"); } return {}; }); expect((await request()).status).toBe(400); expect((await request()).status).toBe(200);
 expect(m.push.mock.calls.map(([payload]) => payload.idempotencyKey)).toEqual(["cleaner-invoice-submission", "cleaner-invoice-submission"]);
});
it.each([{status:'PAID'},{paidAmount:0},{xeroBillId:'remote'},null])('rechecks export eligibility under the reservation lock %j',async change=>{m.find.mockResolvedValueOnce({...submission}).mockResolvedValueOnce(change?{...submission,...change}:null);expect((await request()).status).toBe(400);expect(m.push).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();});
it('retries a reserved export using the same document identity',async()=>{submission.status='XERO_EXPORTING';expect((await request()).status).toBe(200);expect(m.push.mock.calls[0][0].idempotencyKey).toBe('cleaner-invoice-submission');});
it("refuses before reserving or contacting Xero when no cleaner bill account is chosen", async () => {
  settings.xero.cleanerBillAccountCode = "";
  const response = await request();
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("Choose the Xero account for cleaner invoices in Settings");
  expect(m.push).not.toHaveBeenCalled();
  expect(m.update).not.toHaveBeenCalled();
  settings.xero.cleanerBillAccountCode = "477";
});
it("sends each line to its account: work to the cleaning account, reimbursements to theirs", async () => {
  settings.xero.cleanerBillReimbursementAccountCode = "620";
  submission.lineData = { lines: [{ description: "Work", quantity: 1, unitAmount: 50, kind: "CLEANING" }, { description: "Shopping reimbursement · Run", quantity: 1, unitAmount: 12, kind: "CLEANING" }, { description: "QA inspection · 1 Jan", quantity: 1, unitAmount: 30, kind: "INSPECTION" }] };
  expect((await request()).status).toBe(200);
  expect(m.push.mock.calls[0][0].lineItems.map((line: { accountCode: string }) => line.accountCode)).toEqual(["477", "620", "477"]);
  settings.xero.cleanerBillReimbursementAccountCode = "";
});
