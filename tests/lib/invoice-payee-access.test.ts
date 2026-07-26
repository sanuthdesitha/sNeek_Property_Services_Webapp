import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * WHO may raise an invoice, and WHOSE invoice they get.
 *
 * The cleaner invoice rail now serves two payee kinds: CLEANERs and
 * QA_INSPECTORs (inspection pay was already computed and billed on this rail —
 * what was missing was access). Widening a role gate on money endpoints is only
 * safe under two rules, and this suite pins both:
 *
 *   1. ROLE — exactly {CLEANER, QA_INSPECTOR} may reach the invoice endpoints.
 *      No other role, however senior, self-invoices here.
 *   2. OWNERSHIP — the payee is always the SESSION user. The gate hands back a
 *      session and nothing else; it never accepts, resolves or trusts a
 *      caller-supplied payee id, so a widened role can't read or send anyone
 *      else's invoice.
 *
 * Plus the payee-eligibility predicate: a payee whose invoice details are
 * incomplete must be told what's missing and where to fix it, rather than
 * emailing accounts a PDF with no ABN or bank account on it.
 */

const requireRole = vi.fn(async (_roles: any[]) => ({
  user: { id: "u1", role: "CLEANER" },
})) as any;
const getAppSettings = vi.fn(async () => ({
  cleanerPortalVisibility: { showInvoices: true },
})) as any;

vi.mock("@/lib/auth/session", () => ({ requireRole: (r: any) => requireRole(r) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: () => getAppSettings() }));

import {
  INVOICE_PAYEE_ROLES,
  canRaiseInvoice,
  invoicePayeeMissingFields,
  invoicePayeeProfileHref,
  isInvoicePayeeRole,
  requiredProfileFields,
} from "@/lib/profile/completeness";
import {
  adaptInvoiceEmailForPayee,
  invoiceErrorMessage,
  invoiceErrorStatus,
  invoiceFileStem,
  requireInvoicePayeeSession,
} from "@/lib/invoicing/access";

const COMPLETE_PAYEE = {
  name: "Jane Inspector",
  phone: "0400 000 000",
  email: "jane@example.com",
  address: "1 Test St, Sydney NSW 2000",
  abn: "12 345 678 901",
  bankAccountName: "Jane Inspector",
  bankBsb: "062-000",
  bankAccountNumber: "12345678",
};

beforeEach(() => {
  requireRole.mockReset();
  requireRole.mockImplementation(async () => ({ user: { id: "u1", role: "CLEANER" } }));
  getAppSettings.mockReset();
  getAppSettings.mockImplementation(async () => ({
    cleanerPortalVisibility: { showInvoices: true },
  }));
});

describe("who may raise an invoice", () => {
  it("is exactly cleaners and QA inspectors", () => {
    expect([...INVOICE_PAYEE_ROLES].sort()).toEqual(["CLEANER", "QA_INSPECTOR"]);
    expect(isInvoicePayeeRole("CLEANER")).toBe(true);
    expect(isInvoicePayeeRole("QA_INSPECTOR")).toBe(true);
  });

  it("excludes every other role — seniority does not grant self-invoicing", () => {
    for (const role of ["ADMIN", "OPS_MANAGER", "CLIENT", "LAUNDRY"]) {
      expect(isInvoicePayeeRole(role)).toBe(false);
      expect(canRaiseInvoice({ ...COMPLETE_PAYEE, role }).allowed).toBe(false);
      expect(canRaiseInvoice({ ...COMPLETE_PAYEE, role }).roleAllowed).toBe(false);
    }
  });

  it("excludes a missing/unknown role rather than defaulting open", () => {
    expect(isInvoicePayeeRole(null)).toBe(false);
    expect(isInvoicePayeeRole(undefined)).toBe(false);
    expect(isInvoicePayeeRole("")).toBe(false);
    expect(canRaiseInvoice({ ...COMPLETE_PAYEE }).allowed).toBe(false);
  });
});

describe("payee eligibility — role AND complete invoice details", () => {
  it("allows a QA inspector with every payee detail on file", () => {
    const result = canRaiseInvoice({ ...COMPLETE_PAYEE, role: "QA_INSPECTOR" });
    expect(result.allowed).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("allows a cleaner with every payee detail on file (unchanged behaviour)", () => {
    expect(canRaiseInvoice({ ...COMPLETE_PAYEE, role: "CLEANER" }).allowed).toBe(true);
  });

  it("blocks an inspector missing bank/ABN details and names each one", () => {
    const result = canRaiseInvoice({
      ...COMPLETE_PAYEE,
      role: "QA_INSPECTOR",
      abn: null,
      bankBsb: "   ",
      bankAccountNumber: "",
    });
    expect(result.allowed).toBe(false);
    expect(result.roleAllowed).toBe(true);
    expect(result.missing.map((f) => f.key).sort()).toEqual([
      "abn",
      "bankAccountNumber",
      "bankBsb",
    ]);
  });

  it("requires the SAME details from an inspector as from a cleaner", () => {
    const bare = { name: "", phone: "", email: "", role: "" };
    const cleanerMissing = invoicePayeeMissingFields({ ...bare }).map((f) => f.key);
    expect(cleanerMissing).toEqual([
      "name",
      "phone",
      "email",
      "address",
      "abn",
      "bankAccountName",
      "bankBsb",
      "bankAccountNumber",
    ]);
    expect(canRaiseInvoice({ ...bare, role: "QA_INSPECTOR" }).missing.map((f) => f.key)).toEqual(
      cleanerMissing
    );
  });

  it("never leaks a stored value — only field labels come back", () => {
    const result = canRaiseInvoice({ ...COMPLETE_PAYEE, role: "QA_INSPECTOR", bankAccountNumber: "" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("12 345 678 901");
    expect(serialized).not.toContain("062-000");
    expect(result.missing[0]).toEqual({ key: "bankAccountNumber", label: "Bank account number" });
  });

  it("points each payee kind at its own portal's profile screen", () => {
    expect(invoicePayeeProfileHref("QA_INSPECTOR")).toBe("/v2/qa/profile");
    expect(invoicePayeeProfileHref("CLEANER")).toBe("/v2/cleaner/profile");
    expect(canRaiseInvoice({ ...COMPLETE_PAYEE, role: "QA_INSPECTOR", abn: null }).fixUrl).toBe(
      "/v2/qa/profile"
    );
  });

  it("makes the invoice fields compulsory on an inspector's profile, not just a cleaner's", () => {
    const inspectorKeys = requiredProfileFields("QA_INSPECTOR" as any).map((f) => f.key);
    const cleanerKeys = requiredProfileFields("CLEANER" as any).map((f) => f.key);
    expect(inspectorKeys).toEqual(cleanerKeys);
    expect(inspectorKeys).toContain("abn");
    expect(inspectorKeys).toContain("bankAccountNumber");
    // A role that does not invoice is still only asked for contact details.
    expect(requiredProfileFields("CLIENT" as any).map((f) => f.key)).toEqual([
      "name",
      "phone",
      "email",
    ]);
  });
});

describe("the route gate", () => {
  it("admits exactly the invoice payee roles — the same list the predicate uses", async () => {
    await requireInvoicePayeeSession();
    expect(requireRole).toHaveBeenCalledWith(INVOICE_PAYEE_ROLES);
    const passed = requireRole.mock.calls[0][0];
    expect([...passed].sort()).toEqual(["CLEANER", "QA_INSPECTOR"]);
  });

  it("returns the SESSION user as the payee — never a caller-supplied id", async () => {
    requireRole.mockImplementation(async () => ({ user: { id: "inspector-9", role: "QA_INSPECTOR" } }));
    const session = await requireInvoicePayeeSession();
    // The gate's whole output is the session; there is no seam through which a
    // request body could nominate someone else's id as the payee.
    expect(session.user.id).toBe("inspector-9");
    expect(Object.keys(session)).toEqual(["user"]);
  });

  it("propagates an unauthenticated/forbidden rejection unchanged", async () => {
    requireRole.mockImplementation(async () => {
      throw new Error("FORBIDDEN");
    });
    await expect(requireInvoicePayeeSession()).rejects.toThrow("FORBIDDEN");
    expect(invoiceErrorStatus("FORBIDDEN")).toBe(403);
    expect(invoiceErrorStatus("UNAUTHORIZED")).toBe(401);
  });

  it("still honours the cleaner portal's invoices toggle FOR CLEANERS", async () => {
    getAppSettings.mockImplementation(async () => ({
      cleanerPortalVisibility: { showInvoices: false },
    }));
    await expect(requireInvoicePayeeSession()).rejects.toThrow("INVOICES_DISABLED");
    expect(invoiceErrorStatus("INVOICES_DISABLED")).toBe(403);
    expect(invoiceErrorMessage("INVOICES_DISABLED")).toBe("Invoices are disabled for cleaners.");
  });

  it("does NOT let the cleaner-portal toggle cut off an inspector's pay", async () => {
    requireRole.mockImplementation(async () => ({ user: { id: "u2", role: "QA_INSPECTOR" } }));
    getAppSettings.mockImplementation(async () => ({
      cleanerPortalVisibility: { showInvoices: false },
    }));
    const session = await requireInvoicePayeeSession();
    expect(session.user.id).toBe("u2");
    // The inspector's rail doesn't even read the cleaner portal settings.
    expect(getAppSettings).not.toHaveBeenCalled();
  });
});

describe("payee-aware output", () => {
  it("names the PDF for the payee kind", () => {
    expect(invoiceFileStem("QA_INSPECTOR")).toBe("qa-inspector-invoice");
    expect(invoiceFileStem("CLEANER")).toBe("cleaner-invoice");
    expect(invoiceFileStem(undefined)).toBe("cleaner-invoice");
  });

  it("leaves a cleaner's invoice email exactly as the admin template renders it", () => {
    const email = { subject: "sNeek - Cleaner Invoice Bob", html: "<p>cleaner invoice</p>" };
    expect(adaptInvoiceEmailForPayee("CLEANER", email)).toEqual(email);
  });

  it("relabels an inspector's invoice email so accounts aren't told it's a cleaner's", () => {
    const out = adaptInvoiceEmailForPayee("QA_INSPECTOR", {
      subject: "sNeek - Cleaner Invoice Jane",
      html: "<p>Please find the attached cleaner invoice for <b>Jane</b>.</p>",
    });
    expect(out.subject).toBe("sNeek - QA inspector Invoice Jane");
    expect(out.html).not.toMatch(/cleaner invoice/i);
    expect(out.html).toContain("QA inspector invoice");
  });

  it("still marks the email when an admin has rewritten the template copy away", () => {
    const out = adaptInvoiceEmailForPayee("QA_INSPECTOR", {
      subject: "sNeek - Contractor bill",
      html: "<p>Bill attached.</p>",
    });
    expect(out.subject).toBe("sNeek - Contractor bill (QA inspections)");
  });
});
