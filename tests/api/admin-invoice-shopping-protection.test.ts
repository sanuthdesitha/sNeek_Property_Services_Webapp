// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn(), lines: vi.fn(), update: vi.fn(), lineUpdate: vi.fn(), lineDelete: vi.fn(), lineCreate: vi.fn(), remove: vi.fn(), release: vi.fn(), audit: vi.fn(), email: vi.fn(), events: [] as string[] }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/billing/client-invoices", () => ({ getClientInvoice: vi.fn(), releaseInvoiceConsumables: m.release }));
vi.mock("@/lib/db", () => ({ db: { clientInvoice: { findUnique: m.find }, clientInvoiceLine: { findMany: m.lines }, $transaction: async (work: any) => { const result = await work({ $queryRaw: vi.fn(), clientInvoice: { findUnique: m.find, update: m.update, delete: m.remove }, auditLog: { create: m.audit }, clientInvoiceLine: { findMany: m.lines, update: m.lineUpdate, create: m.lineCreate, delete: m.lineDelete } }); m.events.push("committed"); return result; } } }));
vi.mock("@/lib/notifications/email", () => ({sendEmailDetailed:m.email}));
vi.mock("@/lib/settings", () => ({getAppSettings:async()=>({companyName:"Test"})}));
import { PATCH, DELETE } from "@/app/api/admin/invoices/[id]/route";
const id = "cl00000000000000000000001"; const context = { params: { id: "invoice" } };
const req = (body: unknown) => new NextRequest("http://local", { method: "PATCH", body: JSON.stringify(body) });
let invoice: any;
beforeEach(() => { vi.clearAllMocks(); m.events = []; m.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } }); invoice = { id: "invoice", status: "DRAFT", subtotal: 150, gstAmount: 15, totalAmount: 165, gstEnabled: true, lines: [{ id, shoppingClientChargeId: "charge", shoppingRunId: "run", quantity: 1, unitPrice: 100, lineTotal: 100, category: "SHOPPING_DISBURSEMENT" }] }; m.find.mockImplementation(async () => invoice); m.update.mockImplementation(async ({ data }) => ({ ...invoice, ...data })); m.lines.mockResolvedValue([...invoice.lines, { id: "service", category: "SERVICE", lineTotal: 50 }]); });
it.each([{ removeLineId: id }, { updateLines: [{ id, unitPrice: 20 }] }, { updateLines: [{ id, quantity: 2 }] }, { updateLines: [{ id, propertyId: null }] }])("protects reviewed shopping lines from financial or destination edits: %j", async body => { expect((await PATCH(req(body), context)).status).toBe(409); expect(m.update).not.toHaveBeenCalled(); expect(m.lineUpdate).not.toHaveBeenCalled(); expect(m.lineDelete).not.toHaveBeenCalled(); });
it("also protects legacy run-bound shopping lines", async () => { invoice.lines[0].shoppingClientChargeId = null; expect((await PATCH(req({ removeLineId: id }), context)).status).toBe(409); });
it.each(["SHOPPING_DISBURSEMENT", "SHOPPING_TIME", "SHOPPING_REIMBURSEMENT"])("reserves %s additions for reviewed allocations", async category => { expect((await PATCH(req({ addLine: { category, description: "Manual purchase", unitPrice: 10 } }), context)).status).toBe(400); expect(m.lineCreate).not.toHaveBeenCalled(); });
it("recalculates mixed line GST excluding only agency disbursements", async () => { const result = await PATCH(req({ gstEnabled: true }), context); expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ subtotal: 150, gstAmount: 5, totalAmount: 155 }); });
it("disables GST without dropping disbursements from the invoice total", async () => { const result = await PATCH(req({ gstEnabled: false }), context); expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ subtotal: 150, gstAmount: 0, totalAmount: 150 }); });
it("permits a description correction while retaining allocated amounts and GST treatment", async () => { const result = await PATCH(req({ updateLines: [{ id, description: "Correct room label" }] }), context); expect(result.status).toBe(200); expect(m.lineUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ description: "Correct room label", lineTotal: 100 }) })); expect(await result.json()).toMatchObject({ gstAmount: 5, totalAmount: 155 }); });
it("refuses edits while the durable Xero reservation is pending", async () => {
 invoice.metadata = { xeroExportState: "PENDING" }; expect((await PATCH(req({ gstEnabled: false }), context)).status).toBe(409); expect(m.update).not.toHaveBeenCalled();
});
it("refuses alteration of an exported invoice", async () => {
 invoice.xeroInvoiceId = "remote"; expect((await PATCH(req({ updateLines: [{ id, description: "Changed" }] }), context)).status).toBe(409); expect(m.lineUpdate).not.toHaveBeenCalled();
});
it("refuses force status override which would resurrect voided work", async () => {
 invoice.status = "VOID"; expect((await PATCH(req({ status: "DRAFT", forceStatus: true }), context)).status).toBe(409); expect(m.update).not.toHaveBeenCalled();
});
it("preserves recorded money when asked to reverse", async () => {
 invoice.status = "PAID"; invoice.paidAmount = 165; expect((await PATCH(req({ reverse: { reason: "Incorrect line" } }), context)).status).toBe(409); expect(m.update).not.toHaveBeenCalled();
});

it.each([{status:"SENT"},{xeroInvoiceId:"remote"},{paidAt:new Date()},{paidAmount:1},{metadata:{xeroExportState:"PENDING"}}])("refuses deleting protected client invoice %j",async fields=>{Object.assign(invoice,fields);expect((await DELETE(req({}),context)).status).toBe(400);expect(m.remove).not.toHaveBeenCalled();expect(m.release).not.toHaveBeenCalled();});
it("releases unpaid draft consumables before deleting",async()=>{expect((await DELETE(req({}),context)).status).toBe(200);expect(m.release).toHaveBeenCalledWith(expect.anything(),"invoice");expect(m.remove).toHaveBeenCalledWith({where:{id:"invoice"}});});
it("records a payment and sends a receipt from committed data",async()=>{invoice.status="SENT";invoice.client={name:"Client",email:"client@local"};invoice.paidAmount=0;m.update.mockImplementation(async({data})=>{Object.assign(invoice,data);return {...invoice};});expect((await PATCH(req({recordPayment:{amount:10,method:"BANK_TRANSFER",paidDate:"2026-10-03",reference:"bank"}}),context)).status).toBe(200);expect(m.audit).toHaveBeenCalled(); expect(m.events).toContain("committed"); await vi.waitFor(()=>expect(m.email).toHaveBeenCalledOnce());expect(invoice.paidAmount).toBe(10);});
it("does not send payment receipt when transaction write fails",async()=>{invoice.status="SENT";invoice.client={email:"client@local"};m.update.mockRejectedValue(new Error("write failed"));expect((await PATCH(req({recordPayment:{amount:10,method:"BANK_TRANSFER"}}),context)).status).toBe(400);expect(m.email).not.toHaveBeenCalled();});

it("keeps recorded payment when receipt delivery rejects",async()=>{invoice.status="SENT";invoice.client={email:"client@local"};m.email.mockRejectedValue(new Error("mail unavailable"));expect((await PATCH(req({recordPayment:{amount:10,method:"CASH"}}),context)).status).toBe(200);await vi.waitFor(()=>expect(m.email).toHaveBeenCalledOnce());expect(m.events).toContain("committed");});
it.each([{status:'APPROVED'},{recordPayment:{amount:10,method:'CASH'}}])('blocks unresolved started-work financial action %j',async body=>{invoice.metadata={startedWorkReview:{version:1,required:true,periodStart:'2026-10-01',periodEnd:'2026-10-15',jobs:[]}};expect((await PATCH(req(body),context)).status).toBe(400);expect(m.update).not.toHaveBeenCalled();expect(m.email).not.toHaveBeenCalled();});
