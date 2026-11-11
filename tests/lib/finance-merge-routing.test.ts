import { describe, expect, it, vi } from "vitest";
import { allOpsLevels, canUseOpsPath, opsNavigationHref, opsRequestFeature } from "@/lib/rbac/ops-catalog";
import { financeTabRedirect } from "@/lib/admin/finance-redirects";

const nav = vi.hoisted(() => ({ redirect: vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`); }) }));
vi.mock("next/navigation", () => ({ redirect: nav.redirect }));

describe("Invoices and pay redirects", () => {
  it("sends the old payroll and cleaner-invoice entries to their tabs, keeping other params", async () => {
    const { default: payroll } = await import("@/app/v2/admin/payroll/page");
    const { default: cleanerInvoices } = await import("@/app/v2/admin/cleaner-invoices/page");
    expect(() => payroll({ searchParams: { tab: "old", run: "r1" } })).toThrow("REDIRECT /v2/admin/finance?tab=payroll&run=r1");
    expect(() => cleanerInvoices({ searchParams: { status: "SUBMITTED" } })).toThrow("REDIRECT /v2/admin/finance?tab=cleaner-invoices&status=SUBMITTED");
    expect(() => cleanerInvoices({})).toThrow("REDIRECT /v2/admin/finance?tab=cleaner-invoices");
  });

  it("repeats multi-valued params", () => {
    expect(financeTabRedirect("payroll", { a: ["1", "2"], skip: undefined })).toBe("/v2/admin/finance?tab=payroll&a=1&a=2");
  });
});

describe("operations-manager ownership of the merged page", () => {
  it("maps payee tabs to payroll and the rest to finance, on pages only", () => {
    expect(opsRequestFeature("/v2/admin/finance")).toBe("finance");
    expect(opsRequestFeature("/v2/admin/finance?tab=invoices")).toBe("finance");
    expect(opsRequestFeature("/v2/admin/finance?tab=overview")).toBe("finance");
    for (const tab of ["cleaner-invoices", "payroll", "adjustments", "time"]) {
      expect(opsRequestFeature(`/v2/admin/finance?tab=${tab}`)).toBe("payroll");
    }
    // An API path cannot be steered by a query string.
    expect(opsRequestFeature("/api/admin/finance?tab=payroll")).toBe("finance");
    expect(opsRequestFeature("/api/admin/invoices/bulk")).toBe("finance");
    expect(opsRequestFeature("/api/admin/invoices/export?tab=payroll")).toBe("finance");
  });

  it("keeps a payroll-only manager's entry and hides it when both are off", () => {
    const payrollOnly = { ...allOpsLevels("off"), payroll: "manage" as const };
    expect(opsNavigationHref(payrollOnly, "/v2/admin/finance")).toBe("/v2/admin/finance?tab=cleaner-invoices");
    expect(canUseOpsPath(payrollOnly, "/v2/admin/finance")).toBe(false);
    expect(opsNavigationHref(allOpsLevels("off"), "/v2/admin/finance")).toBeNull();
    const financeOnly = { ...allOpsLevels("off"), finance: "read" as const };
    expect(opsNavigationHref(financeOnly, "/v2/admin/finance")).toBe("/v2/admin/finance");
    expect(canUseOpsPath(financeOnly, "/v2/admin/finance?tab=payroll")).toBe(false);
    expect(canUseOpsPath(financeOnly, "/api/admin/invoices/bulk", "POST")).toBe(false);
  });
});
