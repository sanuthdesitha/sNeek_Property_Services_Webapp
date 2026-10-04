// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ claim: vi.fn(), update: vi.fn(), send: vi.fn(), pdf: vi.fn(), data: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { cleanerInvoiceSubmission: { updateMany: m.update } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ accountsEmail: "accounts@example.test" }) }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.send }));
vi.mock("@/lib/email-templates", () => ({ renderEmailTemplate: () => ({ subject: "Invoice", html: "" }) }));
vi.mock("@/lib/cleaner/invoice", () => ({ getCleanerInvoiceData: m.data, buildCleanerInvoiceHtml: () => "invoice", renderCleanerInvoicePdf: m.pdf }));
vi.mock("@/lib/profile/completeness", () => ({ invoicePayeeMissingFields: () => [], invoicePayeeProfileHref: () => "/profile" }));
vi.mock("@/lib/invoicing/access", () => ({ requireInvoicePayeeSession: async () => ({ user: { id: "cleaner", role: "CLEANER" } }), adaptInvoiceEmailForPayee: (_: any, template: any) => template, invoiceErrorMessage: (x: any) => x, invoiceErrorStatus: () => 409, invoiceFileStem: () => "cleaner" }));
vi.mock("@/lib/cleaner/invoice-claim", () => ({ claimCleanerInvoice: m.claim }));
import { POST } from "@/app/api/cleaner/invoice/send/route";
let events: string[];
const request = () => POST(new Request("http://localhost/invoice", { method: "POST", body: JSON.stringify({ confirmEmail: true, requestId: "00000000-0000-4000-8000-000000000001" }) }) as any);
beforeEach(() => {
 vi.resetAllMocks(); events = [];
 m.data.mockResolvedValue({ cleanerName: "Test", start: new Date(), end: new Date(), rows: [{ jobId: "job", amount: 50 }], extraLineRows: [], qaInspectionRows: [], transportAllowanceRows: [], expenseRows: [], shoppingTimeRows: [], includedQaAssignmentIds: [], includedAdjustmentIds: [], claimableAllowanceDays: [], estimatedPay: 50 });
 m.claim.mockImplementation(async () => { events.push("claim-committed"); return { id: "receipt", invoiceNumber: "CL-1", status: "SENDING", reused: false }; });
 m.pdf.mockResolvedValue(Buffer.from("pdf")); m.send.mockImplementation(async () => { events.push("send"); return { ok: true }; }); m.update.mockImplementation(async () => { events.push("update"); return { count: 1 }; });
});
it("sends only after all claims commit and finalizes the durable receipt", async () => {
 expect((await request()).status).toBe(200); expect(events).toEqual(["claim-committed", "send", "update"]);
 expect(m.update.mock.calls[0][0].data).toMatchObject({ status: "SUBMITTED", lineData: { delivery: "SENT" } });
});
it("never emails when any claim failed", async () => {
 m.claim.mockRejectedValue(new Error("payroll won claim")); expect((await request()).status).toBe(409); expect(m.send).not.toHaveBeenCalled();
});
it.each(["provider-failure", "provider-throws", "pdf-failure", "final-write-failure"])("retains durable reservation for review after %s", async failure => {
 if (failure === "provider-failure") m.send.mockResolvedValue({ ok: false });
 if (failure === "provider-throws") m.send.mockRejectedValue(new Error("timeout"));
 if (failure === "pdf-failure") m.pdf.mockRejectedValue(new Error("renderer unavailable"));
 if (failure === "final-write-failure") m.update.mockRejectedValue(new Error("database unavailable"));
 const response = await request(); expect(response.status).toBe(502); expect(await response.json()).toMatchObject({ invoiceId: "receipt", requiresReview: true, status: "SENDING" });
});
it.each(["SENDING", "SUBMITTED"])("returns %s receipt on retry without a second email", async status => {
 m.claim.mockResolvedValue({ id: "old", status, reused: true }); const response = await request(); expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({ invoiceId: "old", requiresReview: status !== "SUBMITTED" }); expect(m.send).not.toHaveBeenCalled(); expect(m.pdf).not.toHaveBeenCalled();
});
