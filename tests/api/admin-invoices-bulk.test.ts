import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: vi.fn(),
  findMany: vi.fn(),
  audit: vi.fn(),
  patch: vi.fn(),
  send: vi.fn(),
  xero: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: { clientInvoice: { findMany: m.findMany }, auditLog: { create: m.audit } } }));
// The bulk route must call the SAME action functions the single routes call.
vi.mock("@/lib/billing/client-invoice-patch", () => ({ patchClientInvoice: m.patch }));
vi.mock("@/lib/billing/client-invoice-send", () => ({ sendClientInvoice: m.send }));
vi.mock("@/lib/billing/client-invoice-xero", () => ({ pushClientInvoiceToXeroOnce: m.xero }));

import { POST } from "@/app/api/admin/invoices/bulk/route";
import { POST as singleSend } from "@/app/api/admin/invoices/[id]/send/route";
import { POST as singleXero } from "@/app/api/admin/invoices/[id]/xero-push/route";
import { PATCH as singlePatch } from "@/app/api/admin/invoices/[id]/route";

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/admin/invoices/bulk", { method: "POST", body: JSON.stringify(body) }));

const INVOICES = [
  { id: "d1", invoiceNumber: "INV-1", status: "DRAFT" },
  { id: "d2", invoiceNumber: "INV-2", status: "DRAFT" },
  { id: "a1", invoiceNumber: "INV-3", status: "APPROVED" },
  { id: "s1", invoiceNumber: "INV-4", status: "SENT" },
];
const actor = { id: "ops", role: "OPS_MANAGER", name: "Ops", email: "ops@example.test" };

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: actor });
  m.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => INVOICES.filter((row) => where.id.in.includes(row.id)));
  m.audit.mockResolvedValue({});
  m.patch.mockImplementation(async ({ invoiceId }: { invoiceId: string }) =>
    invoiceId === "d2"
      ? { status: 409, body: { error: "Review the started-work draft before approving." } }
      : { status: 200, body: { id: invoiceId, status: "APPROVED" } },
  );
  m.send.mockResolvedValue({ status: 200, body: { ok: true } });
  m.xero.mockImplementation(async (id: string) =>
    id === "s1" ? { status: 200, body: { ok: true, alreadyPushed: true } } : id === "a1" ? { status: 400, body: { error: "Invoice changed before export. Refresh and retry." } } : { status: 200, body: { ok: true, xeroInvoiceId: "X" } },
  );
});

describe("POST /api/admin/invoices/bulk", () => {
  it("approves sequentially through the shared PATCH action and reports each row honestly", async () => {
    const response = await post({ action: "approve", ids: ["d1", "d2", "a1", "missing"] });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results).toEqual([
      { id: "d1", invoiceNumber: "INV-1", ok: true, outcome: "done" },
      { id: "d2", invoiceNumber: "INV-2", ok: false, outcome: "refused", reason: "Review the started-work draft before approving." },
      { id: "a1", invoiceNumber: "INV-3", ok: false, outcome: "unchanged", reason: "Already approved. Nothing changed." },
      { id: "missing", invoiceNumber: null, ok: false, outcome: "refused", reason: "Invoice not found." },
    ]);
    expect(body.summary).toEqual({ done: 1, refused: 2, unchanged: 1 });
    expect(m.patch).toHaveBeenCalledTimes(2);
    expect(m.patch).toHaveBeenCalledWith({ invoiceId: "d1", body: { status: "APPROVED" }, actor });
    // One request-level audit row; per-row audit stays with the shared action.
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "CLIENT_INVOICE_BULK_ACTION", userId: "ops" }) }));
  });

  it("approve-and-send runs both steps in order and never sends a row whose approval was refused", async () => {
    const body = await (await post({ action: "approve-and-send", ids: ["d1", "d2", "a1", "s1"] })).json();
    expect(body.results.map((row: { id: string; outcome: string }) => [row.id, row.outcome])).toEqual([
      ["d1", "done"], ["d2", "refused"], ["a1", "done"], ["s1", "refused"],
    ]);
    expect(body.results[1].reason).toMatch(/^Not approved, so not sent/);
    expect(m.send.mock.calls.map(([args]) => args.invoiceId)).toEqual(["d1", "a1"]);
    expect(m.patch.mock.invocationCallOrder[0]).toBeLessThan(m.send.mock.invocationCallOrder[0]);
  });

  it("reports a provider failure on send as refused, not done", async () => {
    m.send.mockResolvedValueOnce({ status: 502, body: { error: "Email provider failed." } });
    const body = await (await post({ action: "send", ids: ["d1", "s1"] })).json();
    expect(body.results[0]).toMatchObject({ outcome: "refused", reason: "Email provider failed." });
    expect(body.results[1]).toMatchObject({ outcome: "refused", reason: expect.stringMatching(/Already sent/) });
    expect(body.summary.done).toBe(0);
  });

  it("pushes to Xero through the shared once-only push: done, refused and already-pushed are distinct", async () => {
    const body = await (await post({ action: "xero-push", ids: ["d1", "a1", "s1"] })).json();
    expect(body.results.map((row: { outcome: string }) => row.outcome)).toEqual(["done", "refused", "unchanged"]);
    expect(body.results[1].reason).toBe("Invoice changed before export. Refresh and retry.");
    expect(m.xero.mock.calls.map(([id]) => id)).toEqual(["d1", "a1", "s1"]);
  });

  it("turns an unexpected throw on one row into a refusal and carries on", async () => {
    m.xero.mockRejectedValueOnce(new Error("socket hang up"));
    const body = await (await post({ action: "xero-push", ids: ["d1", "d2"] })).json();
    expect(body.results[0]).toMatchObject({ outcome: "refused", reason: "socket hang up" });
    expect(body.results[1].outcome).toBe("done");
  });

  it.each([
    [{ action: "approve", ids: [] }, /at least one/],
    [{ action: "approve", ids: Array.from({ length: 51 }, (_, i) => `id${i}`) }, /at most 50/],
    [{ action: "delete", ids: ["d1"] }, /./],
    [null, /./],
  ])("refuses an invalid request %#", async (request, message) => {
    const response = await post(request);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(message);
    expect(m.findMany).not.toHaveBeenCalled();
  });

  it("uses the same live role guard as the single routes", async () => {
    await post({ action: "approve", ids: ["d1"] });
    expect(m.role).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
    const response = await post({ action: "approve", ids: ["d1"] });
    expect(response.status).toBe(403);
    expect(m.patch).toHaveBeenCalledTimes(1);
  });
});

describe("single-invoice routes call the same shared actions", () => {
  it("send, xero-push and PATCH delegate to the lib functions the bulk route uses", async () => {
    await singleSend(new NextRequest("http://localhost/api/admin/invoices/d1/send", { method: "POST", body: JSON.stringify({ to: "a@b.test" }) }), { params: { id: "d1" } });
    expect(m.send).toHaveBeenCalledWith({ invoiceId: "d1", to: "a@b.test", origin: "http://localhost" });
    await singleXero(new NextRequest("http://localhost/api/admin/invoices/d1/xero-push", { method: "POST" }), { params: { id: "d1" } });
    expect(m.xero).toHaveBeenCalledWith("d1");
    const patched = await singlePatch(new NextRequest("http://localhost/api/admin/invoices/d2", { method: "PATCH", body: JSON.stringify({ status: "APPROVED" }) }), { params: { id: "d2" } });
    expect(patched.status).toBe(409);
    expect(m.patch).toHaveBeenCalledWith({ invoiceId: "d2", body: { status: "APPROVED" }, actor });
  });
});
