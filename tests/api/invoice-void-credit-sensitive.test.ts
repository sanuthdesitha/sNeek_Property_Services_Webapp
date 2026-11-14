// @vitest-environment node
/**
 * Owner decision 2026-11-13: "Void and credit notes" is a sensitive action.
 * Every route that voids (an invoice or a credit note) or creates a credit note
 * needs `invoices.void_credit` (Finance at Full or the explicit grant; ADMIN
 * always) AND the acting person's own PIN, verified on the server with
 * verifySensitiveAction(…, "invoices.void_credit"). Never while testing as
 * someone. There is no bulk void or bulk credit note.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { EMPTY_OPS_POLICY, opsPolicySchema, type OpsPolicy } from "@/lib/rbac/ops-policy";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";

const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  policy: vi.fn(),
  verify: vi.fn(),
  patch: vi.fn(),
  credit: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsPolicy: m.policy, getOpsAccess: vi.fn() }));
vi.mock("@/lib/security/admin-verification", () => {
  class SensitiveVerificationError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return { verifySensitiveAction: m.verify, SensitiveVerificationError };
});
vi.mock("@/lib/billing/client-invoice-patch", () => ({ patchClientInvoice: m.patch }));
vi.mock("@/lib/billing/client-invoice-create", () => ({ createCreditNote: m.credit }));
vi.mock("@/lib/billing/client-invoices", () => ({ getClientInvoice: vi.fn(), releaseInvoiceConsumables: vi.fn() }));
vi.mock("@/lib/billing/client-invoice-editor", () => ({ loadClientInvoiceEditor: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { PATCH } from "@/app/api/admin/invoices/[id]/route";
import { POST as CREDIT } from "@/app/api/admin/invoices/[id]/credit-note/route";
import { CLIENT_INVOICE_BULK_ACTIONS } from "@/lib/billing/client-invoice-list-types";
import { invoiceBulkCapabilities } from "@/lib/rbac/invoice-capabilities";

const admin = { user: { id: "admin", role: "ADMIN", heldRoles: ["ADMIN"] } };
const manager = { user: { id: "m", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } };

function policyWithFinance(level: "manage" | "full", sensitive?: Record<string, boolean>): OpsPolicy {
  return opsPolicySchema.parse({
    ...EMPTY_OPS_POLICY,
    assignments: { m: { presetId: "existing", overrides: { ...allOpsLevels("manage"), finance: level }, ...(sensitive ? { sensitive } : {}) } },
  });
}

const voidPatch = (body: Record<string, unknown>) =>
  PATCH(new NextRequest("http://local/api/admin/invoices/inv", { method: "PATCH", body: JSON.stringify(body) }), { params: { id: "inv" } });
const credit = (body: Record<string, unknown>) =>
  CREDIT(new NextRequest("http://local/api/admin/invoices/inv/credit-note", { method: "POST", body: JSON.stringify(body) }), { params: { id: "inv" } });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue(manager);
  m.policy.mockResolvedValue(policyWithFinance("full"));
  m.verify.mockResolvedValue(true);
  m.patch.mockResolvedValue({ status: 200, body: { id: "inv", status: "VOID" } });
  m.credit.mockResolvedValue({ status: 201, body: { id: "cn", invoiceNumber: "CN-0001" } });
});

describe("void (PATCH status VOID, invoices and credit notes)", () => {
  it("refuses a manager at Finance Manage before any credential is read", async () => {
    m.policy.mockResolvedValue(policyWithFinance("manage"));
    const response = await voidPatch({ status: "VOID", security: { pin: "2468" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "CAPABILITY_REQUIRED", capability: "invoices.void_credit" });
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.patch).not.toHaveBeenCalled();
  });

  it("allows a manager at Finance Full with their own PIN, checked for this sensitive action", async () => {
    const response = await voidPatch({ status: "VOID", voidReason: "Duplicate", security: { pin: "2468" } });
    expect(response.status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("m", { pin: "2468" }, "invoices.void_credit");
    expect(m.patch).toHaveBeenCalledTimes(1);
  });

  it("allows a manager with the explicit grant at Manage", async () => {
    m.policy.mockResolvedValue(policyWithFinance("manage", { "invoices.void_credit": true }));
    expect((await voidPatch({ status: "VOID", voidReason: "Wrong client", security: { pin: "2468" } })).status).toBe(200);
  });

  it("refuses a wrong or absent PIN with 423 and changes nothing", async () => {
    m.verify.mockRejectedValueOnce(new Error("INVALID_SECURITY_VERIFICATION"));
    expect((await voidPatch({ status: "VOID", security: { pin: "0000" } })).status).toBe(423);
    m.verify.mockRejectedValueOnce(new Error("PIN_OR_PASSWORD_REQUIRED"));
    expect((await voidPatch({ status: "VOID" })).status).toBe(423);
    expect(m.verify).toHaveBeenLastCalledWith("m", null, "invoices.void_credit");
    expect(m.patch).not.toHaveBeenCalled();
  });

  it("asks an administrator for their own PIN too, without reading any policy", async () => {
    m.requireRole.mockResolvedValue(admin);
    expect((await voidPatch({ status: "VOID", voidReason: "Job cancelled", security: { pin: "1357" } })).status).toBe(200);
    expect(m.policy).not.toHaveBeenCalled();
    expect(m.verify).toHaveBeenCalledWith("admin", { pin: "1357" }, "invoices.void_credit");
  });

  it("refuses while testing as someone, administrators included", async () => {
    m.requireRole.mockResolvedValue({ ...manager, impersonation: { actorId: "admin" } });
    expect((await voidPatch({ status: "VOID", security: { pin: "2468" } })).status).toBe(403);
    expect(m.verify).not.toHaveBeenCalled();
    expect(m.patch).not.toHaveBeenCalled();
  });

  // Owner default 2026-11-14 (pending confirmation): a void needs a reason (quick pick, no minimum length).
  it("refuses a void without a reason after the PIN and changes nothing; a short reason is enough", async () => {
    const missing = await voidPatch({ status: "VOID", security: { pin: "2468" } });
    expect(missing.status).toBe(400);
    expect((await missing.json()).code).toBe("REASON_REQUIRED");
    expect((await voidPatch({ status: "VOID", voidReason: "   ", security: { pin: "2468" } })).status).toBe(400);
    expect(m.patch).not.toHaveBeenCalled();
    expect((await voidPatch({ status: "VOID", voidReason: "Dup", security: { pin: "2468" } })).status).toBe(200);
    expect(m.patch).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ voidReason: "Dup" }) }));
  });

  it("other status changes are not asked for a PIN", async () => {
    m.patch.mockResolvedValue({ status: 200, body: {} });
    expect((await voidPatch({ status: "APPROVED" })).status).toBe(200);
    expect(m.verify).not.toHaveBeenCalled();
  });
});

describe("credit note (POST credit-note)", () => {
  it("refuses a manager at Finance Manage", async () => {
    m.policy.mockResolvedValue(policyWithFinance("manage"));
    expect((await credit({ security: { pin: "2468" } })).status).toBe(403);
    expect(m.credit).not.toHaveBeenCalled();
  });

  it("creates with Full and the own PIN; refuses a wrong PIN", async () => {
    expect((await credit({ security: { pin: "2468" } })).status).toBe(201);
    expect(m.verify).toHaveBeenCalledWith("m", { pin: "2468" }, "invoices.void_credit");
    m.verify.mockRejectedValueOnce(new Error("INVALID_SECURITY_VERIFICATION"));
    expect((await credit({ security: { pin: "0000" } })).status).toBe(423);
    expect(m.credit).toHaveBeenCalledTimes(1);
  });

  it("administrator path: PIN asked, no policy read", async () => {
    m.requireRole.mockResolvedValue(admin);
    expect((await credit({ security: { pin: "1357" } })).status).toBe(201);
    expect(m.policy).not.toHaveBeenCalled();
  });
});

describe("bulk", () => {
  it("has no void or credit-note action, so no bulk path bypasses the PIN", () => {
    expect(CLIENT_INVOICE_BULK_ACTIONS.some((action) => /void|credit/i.test(action))).toBe(false);
    for (const action of CLIENT_INVOICE_BULK_ACTIONS) expect(invoiceBulkCapabilities(action)).not.toContain("invoices.void_credit");
  });
});
